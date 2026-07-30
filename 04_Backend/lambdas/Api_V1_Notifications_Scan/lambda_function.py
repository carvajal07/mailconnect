'''
Lambda PROGRAMADA (EventBridge cron, p. ej. una vez al día) que envía NOTIFICACIONES al
DUEÑO (owner) de cada cliente sobre lo que necesita saber sin entrar al portal (Bloque H):

  1. Reputación en riesgo: si el rebote/queja de los últimos 7 días cruza los umbrales de
     SES (rebote >5%/>10%, queja >0.1%/>0.5%), el owner recibe un aviso — su reputación es
     COMPARTIDA con el resto de la plataforma, así que un problema suyo nos afecta a todos.
  2. Resumen diario de actividad: si envió campañas HOY, un correo con los totales del día
     (enviados/entregados/abiertos) leídos del rollup {tenant}_sendSummary (barato).

Cada cliente controla qué recibe con `customer.notify` (FAIL-OPEN por defecto):
  notify = { reputation (default true), digest (default false),
             lowBalance (default true), lowBalanceThreshold (default 20000) }
(lowBalance lo dispara Prepare-batch en el momento del cobro, no esta lambda.)

Ruta: NINGUNA (target de EventBridge Scheduler/cron; sin API). Evento: {} o {dryRun,days}.
Dedup: cada notificación deja una fila en `notificationLog` (PK notifyKey =
customerId#kind#YYYY-MM-DD, TTL) con PutItem CONDICIONAL → no se repite el mismo día aunque
el cron corra varias veces.

[J]: crear la regla EventBridge (rate/cron) → esta lambda (trigger-map.json); IAM
`dynamodb:Scan customer/process`, `BatchGetItem *_sendSummary`, `Scan user`,
`GetItem/PutItem notificationLog` (+ CreateTable/DescribeTable), `ses:SendEmail`.
Env: SENDER_EMAIL, NOTIFY_DASHBOARD_URL (enlace del portal en el correo).
'''
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone

import boto3
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
ddb_client = boto3.client('dynamodb', region_name=REGION)
ses = boto3.client('ses', region_name=REGION)

table_customer = dynamodb.Table('customer')
table_process = dynamodb.Table('process')
table_user = dynamodb.Table('user')

SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'comunicaciones@mailconnect.com.co')
DASHBOARD_URL = os.environ.get('NOTIFY_DASHBOARD_URL', 'https://mailconnect.com.co/panel')
NOTIFY_LOG_TABLE = os.environ.get('NOTIFY_LOG_TABLE', 'notificationLog')
REPUTATION_WINDOW_DAYS = 7
MAX_PROCESSES = 3000

# Umbrales de reputación (fracción sobre enviados) — referencia AWS SES.
BOUNCE_WARN, BOUNCE_CRIT = 0.05, 0.10
COMPLAINT_WARN, COMPLAINT_CRIT = 0.001, 0.005

_MILESTONES = ('enviados', 'entregados', 'abiertos', 'clics', 'rebotes', 'quejas')


# ---------------------------------------------------------------------------
# Armazón de los correos INTERNOS de la plataforma (activación, códigos, avisos).
#
# ⚠️ Está COPIADO en cada lambda que envía correo, siguiendo la convención del repo
# (igual que `tenant_key` o `_audit`): no hay imports compartidos entre lambdas. Si se
# toca aquí, hay que replicarlo en TODAS — la lista está en `DESPLIEGUE.md`.
#
# Por qué tablas y no `<div>`: los correos anteriores usaban `<div style="max-width:600px">`,
# y **Outlook de escritorio ignora `max-width`** (motor de Word) → el correo se desparramaba
# a todo el ancho de la ventana. La maquetación de correo se hace con tablas y una
# "ghost table" condicional para Outlook.
# ---------------------------------------------------------------------------
MAIL_INK = '#16233f'        # navy de la marca
MAIL_BLUE = '#0075be'       # azul de acción
MAIL_CYAN = '#00c3ff'
MAIL_MUTED = '#5b6b86'
MAIL_BORDER = '#e4ebf3'
MAIL_BG = '#f4f7fb'

MAIL_SITE = os.environ.get('SITE_URL', 'https://www.mailconnect.com.co')
# Los assets se sirven junto al sitio (se despliegan con el frontend).
MAIL_ASSETS = os.environ.get('EMAIL_ASSETS_URL', MAIL_SITE + '/email')
MAIL_CONTACT = os.environ.get('CONTACT_EMAIL', 'comunicaciones@mailconnect.com.co')
MAIL_WHATSAPP = os.environ.get('WHATSAPP_URL', 'https://wa.me/573204586576')

# ⚠️ CONFIRMAR los perfiles reales antes de desplegar. Una red con URL vacía simplemente
# NO se dibuja, así que borrar la línea la quita del pie sin tocar nada más.
MAIL_SOCIAL = [
    ('linkedin', 'LinkedIn', os.environ.get('SOCIAL_LINKEDIN', 'https://www.linkedin.com/company/mailconnect')),
    ('facebook', 'Facebook', os.environ.get('SOCIAL_FACEBOOK', 'https://www.facebook.com/mailconnect')),
    ('instagram', 'Instagram', os.environ.get('SOCIAL_INSTAGRAM', 'https://www.instagram.com/mailconnect')),
    ('whatsapp', 'WhatsApp', MAIL_WHATSAPP),
]


def _mail_esc(texto):
    return (str(texto or '').replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def mail_button(etiqueta, url):
    """Botón BULLETPROOF.

    ⚠️ Outlook de escritorio usa el motor de Word, que ignora `border-radius` (el botón
    sale cuadrado) y el `padding` del `<a>` (se encoge al texto, sin alto ni ancho). Se
    emite VML dentro de `[if mso]` y la versión con tabla dentro de `[if !mso]`, así cada
    motor ve UNA sola versión y no se duplica en ninguno.
    """
    etiqueta, url = _mail_esc(etiqueta), _mail_esc(url)
    alto, ancho = 46, max(180, len(etiqueta) * 10 + 56)
    vml = (
        '<!--[if mso]>'
        '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"'
        ' href="{url}" style="width:{w}px;height:{h}px;v-text-anchor:middle;" arcsize="18%"'
        ' fillcolor="{blue}" stroke="f"><w:anchorlock/>'
        '<center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">'
        '{txt}</center></v:roundrect>'
        '<![endif]-->'
    ).format(url=url, w=ancho, h=alto, blue=MAIL_BLUE, txt=etiqueta)
    estandar = (
        '<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 auto;">'
        '<tr><td align="center" bgcolor="{blue}" style="border-radius:8px;">'
        '<a href="{url}" target="_blank" style="display:inline-block;padding:14px 28px;'
        'font-family:Arial,sans-serif;font-size:15px;font-weight:bold;line-height:1.2;'
        'color:#ffffff;text-decoration:none;border-radius:8px;">{txt}</a>'
        '</td></tr></table>'
    ).format(url=url, blue=MAIL_BLUE, txt=etiqueta)
    return ('<div style="text-align:center;margin:28px 0;">' + vml
            + '<!--[if !mso]><!-->' + estandar + '<!--<![endif]--></div>')


def mail_code(codigo):
    """Bloque del código de un solo uso: lo que el destinatario viene a copiar."""
    return (
        '<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:24px auto;">'
        '<tr><td align="center" bgcolor="#eef7fd" style="border-radius:10px;padding:18px 32px;'
        'border:1px solid {border};">'
        '<div style="font-family:Arial,sans-serif;font-size:34px;font-weight:bold;'
        'letter-spacing:8px;color:{blue};">{code}</div></td></tr></table>'
    ).format(code=_mail_esc(codigo), blue=MAIL_BLUE, border=MAIL_BORDER)


def mail_rows(pares):
    """Filas etiqueta/valor (resumen diario, reputación, saldo)."""
    filas = ''.join(
        '<tr><td style="padding:9px 0;border-bottom:1px solid {b};font-family:Arial,sans-serif;'
        'font-size:14px;color:{m};">{k}</td>'
        '<td style="padding:9px 0;border-bottom:1px solid {b};text-align:right;'
        'font-family:Arial,sans-serif;font-size:14px;font-weight:bold;color:{c};">{v}</td></tr>'.format(
            b=MAIL_BORDER, m=MAIL_MUTED, k=_mail_esc(k), v=_mail_esc(v),
            c=(color or MAIL_INK))
        for k, v, color in pares)
    return ('<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"'
            ' style="margin:8px 0 4px;">' + filas + '</table>')


def _mail_social():
    iconos = ''.join(
        '<a href="{url}" target="_blank" style="text-decoration:none;display:inline-block;margin:0 6px;">'
        '<img src="{assets}/red-{slug}.png" width="22" height="22" alt="{nom}"'
        ' style="display:inline-block;border:0;" /></a>'.format(
            url=_mail_esc(url), assets=MAIL_ASSETS, slug=slug, nom=nombre)
        for slug, nombre, url in MAIL_SOCIAL if str(url or '').strip())
    if not iconos:
        return ''
    return '<div style="margin:0 0 14px;">' + iconos + '</div>'


def brand_email(titulo, contenido, cta=None, nota='', preheader=''):
    """Correo interno con la identidad de la plataforma.

    `contenido` es HTML ya compuesto (párrafos, código, filas). `cta` es (texto, url).
    `nota` es la letra chica de por qué se recibe este correo.
    """
    # El preheader es lo que la bandeja muestra JUNTO al asunto; sin él, Gmail muestra el
    # primer texto que encuentre (normalmente el enlace del logo, que no dice nada).
    pre = ('<div style="display:none;font-size:1px;color:#f4f7fb;line-height:1px;'
           'max-height:0;max-width:0;opacity:0;overflow:hidden;">' + _mail_esc(preheader)
           + '&#8199;&#65279;&#847; ' * 20 + '</div>') if preheader else ''

    boton = mail_button(cta[0], cta[1]) if cta else ''
    pie_nota = ('<p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:12px;'
                'line-height:1.6;color:#9aa7bd;">' + nota + '</p>') if nota else ''

    # `<style>` aparte del .format() porque lleva llaves literales de CSS.
    estilos = (
        '<style type="text/css">'
        '@media only screen and (max-width:620px){'
        '  .mc-card{width:100% !important;}'
        '  .mc-pad{padding-left:22px !important;padding-right:22px !important;}'
        '}'
        '</style>'
    )

    cabeza = (
        '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"'
        ' "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">'
        '<html xmlns="http://www.w3.org/1999/xhtml"><head>'
        '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />'
        '<meta name="viewport" content="width=device-width, initial-scale=1" />'
        '<title>' + _mail_esc(titulo) + '</title>' + estilos + '</head>'
    )

    cuerpo = (
        '<body style="margin:0;padding:0;background-color:{bg};">' + pre +
        '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"'
        ' style="background-color:{bg};"><tr><td align="center" style="padding:28px 12px;">'
        # Ghost table: Outlook no respeta max-width, así que allí el ancho se fija aquí.
        '<!--[if mso]><table role="presentation" width="600" border="0" cellpadding="0"'
        ' cellspacing="0"><tr><td><![endif]-->'
        '<table role="presentation" class="mc-card" width="600" border="0" cellpadding="0"'
        ' cellspacing="0" style="width:600px;max-width:600px;background-color:#ffffff;'
        'border:1px solid {border};border-radius:14px;">'

        # Encabezado con el logotipo
        '<tr><td class="mc-pad" align="center" style="padding:30px 36px 8px;">'
        '<a href="{site}" target="_blank" style="text-decoration:none;">'
        '<img src="{assets}/logo.png" width="180" alt="MailConnect"'
        ' style="display:block;border:0;width:180px;max-width:180px;height:auto;" /></a>'
        '</td></tr>'
        # Filete de marca
        '<tr><td style="padding:14px 36px 0;">'
        '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">'
        '<tr><td height="3" bgcolor="{cyan}" style="height:3px;line-height:3px;font-size:0;'
        'border-radius:2px;">&nbsp;</td></tr></table></td></tr>'

        # Contenido
        '<tr><td class="mc-pad" style="padding:26px 36px 6px;">'
        '<h1 style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:22px;'
        'line-height:1.3;color:{ink};">{titulo}</h1>{contenido}</td></tr>'
        '<tr><td class="mc-pad" style="padding:0 36px;">{boton}</td></tr>'

        # Pie
        '<tr><td class="mc-pad" align="center" style="padding:26px 36px 30px;">'
        '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">'
        '<tr><td height="1" bgcolor="{border}" style="height:1px;line-height:1px;font-size:0;">'
        '&nbsp;</td></tr></table>'
        '<div style="padding-top:20px;">{redes}'
        '<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:13px;color:{muted};">'
        '<a href="{site}" target="_blank" style="color:{blue};text-decoration:none;">'
        'mailconnect.com.co</a>'
        ' &nbsp;·&nbsp; <a href="mailto:{correo}" style="color:{blue};text-decoration:none;">'
        '{correo}</a></p>'
        '{nota}'
        '<p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#b3bdcc;">'
        'MailConnect · Comunicaciones masivas omnicanal · Colombia</p>'
        '</div></td></tr>'

        '</table>'
        '<!--[if mso]></td></tr></table><![endif]-->'
        '</td></tr></table></body></html>'
    ).format(bg=MAIL_BG, border=MAIL_BORDER, ink=MAIL_INK, blue=MAIL_BLUE, cyan=MAIL_CYAN,
             muted=MAIL_MUTED, site=MAIL_SITE, assets=MAIL_ASSETS, correo=MAIL_CONTACT,
             titulo=_mail_esc(titulo), contenido=contenido, boton=boton,
             redes=_mail_social(), nota=pie_nota)

    return cabeza + cuerpo


def mail_p(texto, color=None, size=15):
    """Párrafo del cuerpo, con la tipografía del correo."""
    return ('<p style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:{s}px;'
            'line-height:1.65;color:{c};">{t}</p>').format(
                s=size, c=(color or MAIL_INK), t=texto)


def tenant_key(nit):
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def _to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _scan_all(table, **kwargs):
    items = []
    try:
        while True:
            resp = table.scan(**kwargs)
            items.extend(resp.get('Items', []))
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return []
        raise
    return items


# ── Preferencias de notificación del cliente (FAIL-OPEN) ──────────────────────
def _notify_prefs(customer_item):
    raw = customer_item.get('notify') or {}
    if not isinstance(raw, dict):
        raw = {}

    def _b(key, default):
        v = raw.get(key)
        if v is None:
            return default
        if isinstance(v, str):
            return v.strip().lower() in ('true', '1', 'yes', 'si', 'sí')
        return bool(v)

    return {'reputation': _b('reputation', True), 'digest': _b('digest', False),
            'lowBalance': _b('lowBalance', True),
            'lowBalanceThreshold': _to_int(raw.get('lowBalanceThreshold', 20000)) or 20000}


# ── Destinatarios: owners (y, si no hay, cualquier usuario activo) del tenant ──
def _owner_emails(customer_id):
    users = _scan_all(table_user, FilterExpression=Attr('customerId').eq(customer_id),
                      ProjectionExpression='email, tenantRole, active')
    owners = [str(u.get('email')).strip() for u in users
              if u.get('active', True) and str(u.get('tenantRole', 'owner') or 'owner').lower() == 'owner'
              and u.get('email')]
    if owners:
        return list(dict.fromkeys(owners))
    # Sin owner marcado (cuentas viejas): cae a cualquier usuario activo con correo.
    any_active = [str(u.get('email')).strip() for u in users if u.get('active', True) and u.get('email')]
    return list(dict.fromkeys(any_active))


# ── Dedup: una notificación por (cliente, tipo, día) ──────────────────────────
def _ensure_log_table():
    try:
        ddb_client.create_table(
            TableName=NOTIFY_LOG_TABLE,
            KeySchema=[{'AttributeName': 'notifyKey', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'notifyKey', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        ddb_client.get_waiter('table_exists').wait(
            TableName=NOTIFY_LOG_TABLE, WaiterConfig={'Delay': 1, 'MaxAttempts': 15})
    except ClientError as e:
        if e.response['Error']['Code'] != 'ResourceInUseException':
            raise
    try:
        ddb_client.update_time_to_live(
            TableName=NOTIFY_LOG_TABLE,
            TimeToLiveSpecification={'Enabled': True, 'AttributeName': 'expiresAt'})
    except Exception:
        pass


def _claim_notification(customer_id, kind, day):
    """PutItem condicional: True si es la PRIMERA vez que se notifica (cliente, tipo, día)."""
    key = '{}#{}#{}'.format(customer_id, kind, day)
    try:
        dynamodb.Table(NOTIFY_LOG_TABLE).put_item(
            Item={'notifyKey': key, 'customerId': customer_id, 'kind': kind, 'day': day,
                  'createdAt': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
                  'expiresAt': int(time.time()) + 45 * 86400},
            ConditionExpression='attribute_not_exists(notifyKey)')
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            _ensure_log_table()
            return _claim_notification(customer_id, kind, day)
        raise


# ── Correo ────────────────────────────────────────────────────────────────────
def _shell(title, intro, rows, cta='Ver en el portal'):
    """Correo de aviso al owner, con la identidad de la plataforma (ver `brand_email`)."""
    import re as _re
    return brand_email(
        title,
        mail_p(intro) + mail_rows(rows),
        cta=(cta, DASHBOARD_URL),
        nota='Recibes este aviso porque administras una cuenta de MailConnect. Puedes '
             'ajustar tus notificaciones en el portal (Mi cuenta).',
        # El preheader es el intro sin etiquetas: es lo que se lee en la bandeja.
        preheader=_re.sub(r'<[^>]+>', '', str(intro))[:110])


def _row(label, value, color=None):
    """Fila del resumen. Devuelve la TERNA que consume `mail_rows` (no HTML): así el
    formato de la tabla vive en un solo sitio."""
    return (label, value, color)


def _send(emails, subject, html_body, text_body):
    ses.send_email(
        Source=SENDER_EMAIL,
        Destination={'ToAddresses': emails},
        Message={'Subject': {'Data': subject, 'Charset': 'UTF-8'},
                 'Body': {'Html': {'Data': html_body, 'Charset': 'UTF-8'},
                          'Text': {'Data': text_body, 'Charset': 'UTF-8'}}})


# ── Reputación por tenant (rollup de los últimos 7 días) ──────────────────────
def _reputation(company, tenant, procs):
    """(sent, bounces, complaints) del tenant leyendo el rollup por proceso (BatchGet)."""
    pids = [str(p.get('processId')) for p in procs if p.get('processId')]
    table_name = '{}_sendSummary'.format(tenant)
    sent = bounces = complaints = 0
    for i in range(0, len(pids), 100):
        chunk = [{'processId': pid} for pid in pids[i:i + 100]]
        try:
            resp = dynamodb.batch_get_item(RequestItems={table_name: {'Keys': chunk}})
        except Exception:
            break
        for it in resp.get('Responses', {}).get(table_name, []):
            sent += _to_int(it.get('enviados'))
            bounces += _to_int(it.get('rebotes'))
            complaints += _to_int(it.get('quejas'))
    return sent, bounces, complaints


def _level(sent, bounces, complaints):
    if sent <= 0:
        return 'ok'
    br, cr = bounces / sent, complaints / sent
    if br >= BOUNCE_CRIT or cr >= COMPLAINT_CRIT:
        return 'critical'
    if br >= BOUNCE_WARN or cr >= COMPLAINT_WARN:
        return 'warning'
    return 'ok'


def _is_sample(p):
    return bool(p.get('isSamples')) or str(p.get('processState', '')) == 'Muestras'


def lambda_handler(event, context):
    event = event or {}
    dry_run = bool(event.get('dryRun'))
    now = datetime.now(timezone.utc)
    today = now.strftime('%Y-%m-%d')
    win_cut = (now - timedelta(days=REPUTATION_WINDOW_DAYS - 1)).strftime('%Y-%m-%d')

    sent_count = {'reputation': 0, 'digest': 0}
    skipped = 0
    try:
        customers = _scan_all(table_customer,
                              ProjectionExpression='customerId, company, companyTin, notify')
        # Procesos recientes (últimos 7 días), agrupados por empresa (customerName).
        procs = _scan_all(table_process, FilterExpression=Attr('date').gte(win_cut))
        procs = [p for p in procs if not _is_sample(p)][:MAX_PROCESSES]
        by_company = {}
        for p in procs:
            by_company.setdefault(str(p.get('customerName', '')), []).append(p)

        for cust in customers:
            customer_id = cust.get('customerId')
            company = cust.get('company', '')
            tenant = tenant_key(cust.get('companyTin', ''))
            prefs = _notify_prefs(cust)
            cust_procs = by_company.get(company, [])
            if not cust_procs or not tenant:
                continue

            sent, bounces, complaints = _reputation(company, tenant, cust_procs)
            level = _level(sent, bounces, complaints)

            emails = None  # perezoso: solo se buscan si hay algo que enviar

            # (1) Alerta de reputación (warning/critical).
            if prefs['reputation'] and level in ('warning', 'critical') and sent > 0:
                if dry_run or _claim_notification(customer_id, 'reputation', today):
                    emails = emails if emails is not None else _owner_emails(customer_id)
                    if emails and not dry_run:
                        br, cr = bounces / sent, complaints / sent
                        crit = level == 'critical'
                        subject = ('⚠️ Reputación de envío {} — {}'.format(
                            'CRÍTICA' if crit else 'en atención', company))
                        rows = [_row('Enviados (7 días)', '{:,}'.format(sent).replace(',', '.')),
                                _row('Tasa de rebote', '{:.1%}'.format(br),
                                     '#c62828' if br >= BOUNCE_WARN else '#16233f'),
                                _row('Tasa de queja', '{:.2%}'.format(cr),
                                     '#c62828' if cr >= COMPLAINT_WARN else '#16233f')]
                        intro = ('Tu reputación de envío está {}. La reputación es compartida '
                                 'en la plataforma: te recomendamos depurar tus listas (verifica '
                                 'la higiene de la base) y revisar el contenido antes de seguir '
                                 'enviando.'.format('CRÍTICA — el envío podría verse limitado'
                                                    if crit else 'acercándose a los límites'))
                        html = _shell('Reputación de envío en riesgo', intro, rows,
                                      'Revisar reputación')
                        text = ('Reputación de {}: rebote {:.1%}, queja {:.2%} (7 días). '
                                'Depura tus listas antes de seguir enviando. {}'.format(
                                    company, br, cr, DASHBOARD_URL))
                        _send(emails, subject, html, text)
                    sent_count['reputation'] += 1
                else:
                    skipped += 1

            # (2) Resumen diario: solo si hubo actividad HOY.
            today_procs = [p for p in cust_procs if str(p.get('date', ''))[:10] == today]
            if prefs['digest'] and today_procs:
                if dry_run or _claim_notification(customer_id, 'digest', today):
                    emails = emails if emails is not None else _owner_emails(customer_id)
                    if emails and not dry_run:
                        d_sent, d_deliv, d_open = _digest_today(tenant, today_procs)
                        subject = '📊 Resumen de tu actividad de hoy — {}'.format(company)
                        rows = [_row('Campañas enviadas hoy', str(len({p.get('campaignId') for p in today_procs}))),
                                _row('Envíos', '{:,}'.format(d_sent).replace(',', '.')),
                                _row('Entregados', '{:,}'.format(d_deliv).replace(',', '.')),
                                _row('Abiertos', '{:,}'.format(d_open).replace(',', '.'))]
                        html = _shell('Tu resumen de hoy', 'Este es el resumen de la actividad '
                                      'de envío de tu cuenta durante el día.', rows,
                                      'Ver estadísticas')
                        text = 'Resumen de hoy de {}: {} envíos, {} entregados, {} abiertos. {}'.format(
                            company, d_sent, d_deliv, d_open, DASHBOARD_URL)
                        _send(emails, subject, html, text)
                    sent_count['digest'] += 1
                else:
                    skipped += 1

        return {'status': True, 'statusCode': 200,
                'description': 'Barrido de notificaciones completado',
                'data': {'reputationSent': sent_count['reputation'],
                         'digestSent': sent_count['digest'], 'skipped': skipped,
                         'dryRun': dry_run}}
    except Exception as e:
        print('Error en el barrido de notificaciones: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado en el barrido de notificaciones', 'data': {}}


def _digest_today(tenant, today_procs):
    """(enviados, entregados, abiertos) de HOY leyendo el rollup por proceso."""
    pids = [str(p.get('processId')) for p in today_procs if p.get('processId')]
    table_name = '{}_sendSummary'.format(tenant)
    sent = deliv = opened = 0
    by_pid = {}
    for i in range(0, len(pids), 100):
        chunk = [{'processId': pid} for pid in pids[i:i + 100]]
        try:
            resp = dynamodb.batch_get_item(RequestItems={table_name: {'Keys': chunk}})
            for it in resp.get('Responses', {}).get(table_name, []):
                by_pid[str(it.get('processId'))] = it
        except Exception:
            break
    for p in today_procs:
        it = by_pid.get(str(p.get('processId')))
        if it:
            sent += _to_int(it.get('enviados'))
            deliv += _to_int(it.get('entregados'))
            opened += _to_int(it.get('abiertos'))
        else:
            sent += _to_int(p.get('registersToSend'))
    return sent, deliv, opened
