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
            'Body': {'Html': {'Charset': 'UTF-8', 'Data': (
                '<p>Hola,</p>'
                '<p>Te reenviamos el enlace para activar tu cuenta de MailConnect '
                '(solicitado por nuestro equipo de soporte):</p>'
                '<p><a href="{link}">Activar mi cuenta</a></p>'
                '<p>El enlace vence en {hours} horas. Si no lo solicitaste, ignora este correo.</p>'
            ).format(link=link, hours=ACTIVATION_HOURS)}},
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
            'Body': {'Html': {'Charset': 'UTF-8', 'Data': (
                '<p>Hola,</p>'
                '<p>Nuestro equipo de soporte inició el restablecimiento de tu contraseña. '
                'Usa este código en la pantalla de recuperación:</p>'
                '<p style="font-size:22px;font-weight:bold;letter-spacing:3px">{code}</p>'
                '<p>Vence en {mins} minutos. Si no lo solicitaste, ignora este correo.</p>'
            ).format(code=code_str, mins=OTP_EXPIRATION_MIN)}},
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
