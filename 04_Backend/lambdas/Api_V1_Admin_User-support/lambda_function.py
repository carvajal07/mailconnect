'''
Lambda ADMIN de SOPORTE sobre un usuario: acciones puntuales de la ficha del cliente.

Ruta: POST /Admin/User-support  (no-proxy, envelope estándar, admin-only)
Request: { userId, action }
  - action = 'resend-activation' : regenera la clave de activación y reenvía el correo
             (solo cuentas INACTIVAS; 409 si ya está activa). Mismo flujo de Register.
  - action = 'force-reset'       : genera un OTP de recuperación (hasheado, tabla
             oneTimePassword — compatible con Validate-otp/Change-password) y lo envía
             al correo del usuario. El usuario define su clave con el flujo de
             "olvidé mi contraseña" del portal.
  - action = 'revoke-sessions'   : desactiva TODAS las sesiones activas del usuario
             (tabla session). Con la revocación por claim `sid`, sus tokens vivos quedan
             inválidos al expirar el cache del Authorizer.
Respuesta: 200 ok (data según acción) · 400 acción inválida · 404 usuario no existe ·
           409 (resend-activation con cuenta ya activa)

Todas las acciones quedan AUDITADAS (adminAudit: support.resendActivation /
support.forceReset / support.revokeSessions).

⚠️ [J] despliegue: ruta /Admin/User-support (admin) + env SECRET_KEY (2ª barrera) +
SENDER_EMAIL/ACTIVATION_URL/OTP_EXPIRATION_MIN (mismas de Register/Create-otp); IAM:
GetItem user, PutItem userActivation, PutItem/Scan/UpdateItem oneTimePassword,
Scan/UpdateItem session, PutItem adminAudit, ses:SendEmail.
'''
import os
import json
import time
import uuid
import random
import hashlib
from datetime import datetime, timedelta

import boto3

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
ses = boto3.client('ses', region_name=REGION)

table_user = dynamodb.Table('user')
table_activation = dynamodb.Table('userActivation')
table_otp = dynamodb.Table('oneTimePassword')
table_session = dynamodb.Table('session')
_audit_table = dynamodb.Table('adminAudit')

SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'comunicaciones@mailconnect.com.co')
ACTIVATION_URL = os.environ.get(
    'ACTIVATION_URL',
    'https://mtgt9qpb77.execute-api.us-east-1.amazonaws.com/Test/api/account-activation')
OTP_EXPIRATION_MIN = int(os.environ.get('OTP_EXPIRATION_MIN', '15'))
ACTIVATION_HOURS = 24

VALID_ACTIONS = ('resend-activation', 'force-reset', 'revoke-sessions')


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


def _audit(event, action, target='', detail=''):
    try:
        auth = (event.get('requestContext') or {}).get('authorizer') or {}
        _audit_table.put_item(Item={
            'auditId': str(uuid.uuid4()),
            'action': action,
            'actor': str(auth.get('user') or auth.get('userId') or 'admin'),
            'actorId': str(auth.get('userId') or ''),
            'customer': str(auth.get('customer') or ''),
            'target': str(target),
            'detail': str(detail),
            'date': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime()),
        })
    except Exception as e:
        print('No se pudo registrar auditoría: {}'.format(e))


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


# ── Gate admin con SEGUNDA BARRERA (firma del JWT) ───────────────────────────
import base64 as _b64
import hashlib as _hashlib
import hmac as _hmac
import json as _json
import os as _os
import time as _time

_JWT_SECRET = _os.environ.get('SECRET_KEY', '')


def _jwt_claims(token):
    try:
        header_b64, payload_b64, sig_b64 = str(token).split('.')

        def _dec(seg):
            return _b64.urlsafe_b64decode(seg + '=' * (-len(seg) % 4))

        expected = _hmac.new(_JWT_SECRET.encode(),
                             (header_b64 + '.' + payload_b64).encode(),
                             _hashlib.sha256).digest()
        if not _hmac.compare_digest(_dec(sig_b64), expected):
            return None
        if _json.loads(_dec(header_b64)).get('alg') != 'HS256':
            return None
        claims = _json.loads(_dec(payload_b64))
        exp = claims.get('exp')
        if exp is not None and _time.time() >= float(exp):
            return None
        return claims if isinstance(claims, dict) else None
    except Exception:
        return None


def _bearer_token(event):
    raw = ''
    if isinstance(event, dict):
        for k, v in (event.get('headers') or {}).items():
            if str(k).lower() == 'authorization' and v:
                raw = v
                break
        if not raw:
            raw = event.get('authToken') or ''
        if not raw and isinstance(event.get('body'), dict):
            raw = event['body'].get('authToken') or ''
    raw = str(raw).strip()
    if raw.lower().startswith('bearer '):
        raw = raw[7:].strip()
    return raw


def _is_admin(event):
    if not isinstance(event, dict):
        return False
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    context_admin = str(auth.get('role', '')).lower() == 'admin'
    if not _JWT_SECRET:
        print('ADVERTENCIA: SECRET_KEY no configurada; gate admin solo por context.')
        return context_admin
    claims = _jwt_claims(_bearer_token(event))
    return bool(claims) and str(claims.get('role', '')).lower() == 'admin'


# ── Acciones ─────────────────────────────────────────────────────────────────

def _resend_activation(event, user):
    if bool(user.get('active')):
        return {'status': False, 'statusCode': 409,
                'description': 'La cuenta ya está activa; no necesita activación.'}
    email = str(user.get('email', ''))
    activation_key = str(uuid.uuid4())
    expiration = (datetime.utcnow() + timedelta(hours=ACTIVATION_HOURS)).strftime('%Y-%m-%dT%H:%M:%SZ')
    table_activation.put_item(Item={
        'userActivationId': str(uuid.uuid4()),
        'userId': user['userId'],
        'activationKey': activation_key,
        'expirationTime': expiration,
        'used': False,
    })
    link = '{base}?qs={key}'.format(base=ACTIVATION_URL, key=activation_key)
    ses.send_email(
        Source=SENDER_EMAIL,
        Destination={'ToAddresses': [email]},
        Message={
            'Subject': {'Data': 'Activa tu cuenta de MailConnect', 'Charset': 'UTF-8'},
            'Body': {'Html': {'Charset': 'UTF-8', 'Data': brand_email(
                'Activa tu cuenta',
                mail_p('Te reenviamos el enlace para activar tu cuenta de MailConnect, '
                       'solicitado por nuestro equipo de soporte.')
                + mail_p('¿El botón no funciona? Copia este enlace en tu navegador:<br />'
                         '<a href="{l}" style="color:#0075be;word-break:break-all;">{l}</a>'.format(
                             l=_mail_esc(link)), color='#5b6b86', size=13),
                cta=('Activar mi cuenta', link),
                nota='El enlace vence en {} horas. Si no lo solicitaste, ignora este '
                     'correo.'.format(ACTIVATION_HOURS),
                preheader='Tu enlace de activación, reenviado por soporte.')}},
        })
    _audit(event, 'support.resendActivation', email, 'Correo de activación reenviado por soporte.')
    return {'status': True, 'statusCode': 200,
            'description': 'Correo de activación reenviado a {}.'.format(email),
            'data': {'email': email}}


def _force_reset(event, user):
    email = str(user.get('email', ''))
    code = random.randint(100000, 999999)
    code_str = str(code)
    table_otp.put_item(Item={
        'oneTimePasswordId': str(uuid.uuid4()),
        'userId': user['userId'],
        'otpHash': hashlib.sha256(code_str.encode()).hexdigest(),
        'expirationTime': int(time.time()) + OTP_EXPIRATION_MIN * 60,
        'active': True,
        'attempts': 0,
        'system': 'admin-support',
        'ip': '',
        'createdAt': int(time.time()),
    })
    ses.send_email(
        Source=SENDER_EMAIL,
        Destination={'ToAddresses': [email]},
        Message={
            'Subject': {'Data': 'Restablece tu contraseña de MailConnect', 'Charset': 'UTF-8'},
            'Body': {'Html': {'Charset': 'UTF-8', 'Data': brand_email(
                'Restablece tu contraseña',
                mail_p('Nuestro equipo de soporte inició el restablecimiento de tu '
                       'contraseña. Usa este código en la pantalla de recuperación:')
                + mail_code(code_str),
                nota='Vence en {} minutos. Si no lo solicitaste, ignora este correo y tu '
                     'contraseña seguirá igual.'.format(OTP_EXPIRATION_MIN),
                preheader='Tu código de restablecimiento es {}.'.format(code_str))}},
        })
    _audit(event, 'support.forceReset', email,
           'OTP de restablecimiento enviado por soporte (vigencia {} min).'.format(OTP_EXPIRATION_MIN))
    return {'status': True, 'statusCode': 200,
            'description': 'Código de restablecimiento enviado a {}.'.format(email),
            'data': {'email': email, 'expirationMin': OTP_EXPIRATION_MIN}}


def _revoke_sessions(event, user):
    revoked = 0
    kwargs = {
        'FilterExpression': 'userId = :u AND active = :a',
        'ExpressionAttributeValues': {':u': user['userId'], ':a': True},
        'ProjectionExpression': 'sessionId',
    }
    while True:
        resp = table_session.scan(**kwargs)
        for item in resp.get('Items', []):
            table_session.update_item(
                Key={'sessionId': item['sessionId']},
                UpdateExpression='SET active = :f',
                ExpressionAttributeValues={':f': False})
            revoked += 1
        last = resp.get('LastEvaluatedKey')
        if not last:
            break
        kwargs['ExclusiveStartKey'] = last
    _audit(event, 'support.revokeSessions', str(user.get('email', '')),
           'Sesiones cerradas por soporte: {}.'.format(revoked))
    return {'status': True, 'statusCode': 200,
            'description': 'Sesiones cerradas: {}. Los tokens quedan revocados al expirar el cache del Authorizer.'.format(revoked),
            'data': {'revoked': revoked}}


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.'}
    payload = _get_payload(event)
    user_id = str(payload.get('userId') or '').strip()
    action = str(payload.get('action') or '').strip()
    if not user_id or action not in VALID_ACTIONS:
        return {'status': False, 'statusCode': 400,
                'description': 'Indica userId y action ({}).'.format(' | '.join(VALID_ACTIONS))}
    try:
        user = table_user.get_item(Key={'userId': user_id}).get('Item')
        if not user:
            return {'status': False, 'statusCode': 404, 'description': 'El usuario no existe.'}
        if action == 'resend-activation':
            return _resend_activation(event, user)
        if action == 'force-reset':
            return _force_reset(event, user)
        return _revoke_sessions(event, user)
    except Exception as e:
        print('Error en User-support ({}): {}'.format(action, e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado en la acción de soporte.'}
