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
def _shell(title, intro, rows_html, cta='Ver en el portal'):
    body_rows = ''.join(rows_html)
    return """
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#16233f">
      <h2 style="color:#0075be;margin:0 0 8px">{title}</h2>
      <p style="color:#5b6b86;font-size:14px">{intro}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">{rows}</table>
      <p style="margin:20px 0">
        <a href="{url}" style="background:#0075be;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:bold">{cta}</a>
      </p>
      <p style="color:#9aa7bd;font-size:12px;margin-top:24px">
        Recibes este aviso porque administras una cuenta de MailConnect. Puedes ajustar tus
        notificaciones en el portal (Mi cuenta).
      </p>
    </div>
    """.format(title=title, intro=intro, rows=body_rows, url=DASHBOARD_URL, cta=cta)


def _row(label, value, color='#16233f'):
    return ('<tr><td style="padding:6px 0;color:#5b6b86">{}</td>'
            '<td style="padding:6px 0;text-align:right;font-weight:bold;color:{}">{}</td></tr>'
            ).format(label, color, value)


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
