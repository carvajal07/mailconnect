'''
Gestión del SEGUNDO FACTOR (2FA TOTP, RFC 6238) del usuario logueado (Bloque I).
Compatible con Google Authenticator / Authy / 1Password (código de 6 dígitos cada 30 s).

Ruta: POST /Security/Totp  (no-proxy, envelope; detrás del Authorizer del portal)
Request: { action, ... }
  - 'status'   → { enabled, pending }
  - 'enroll'   → genera un secreto PENDIENTE y devuelve { secret, otpauthUri } para el QR.
  - 'activate' { code } → verifica el código contra el secreto pendiente; si es válido,
                 ACTIVA el 2FA y devuelve { backupCodes:[...] } (se muestran UNA vez).
  - 'disable'  { code } → verifica un código TOTP o de respaldo válido y APAGA el 2FA.

El secreto y los códigos de respaldo (hasheados) viven en la tabla `user`. La verificación
en el LOGIN NO ocurre aquí: Login detecta `totpEnabled` y devuelve un desafío que consume
`Api_V1_Security_Verify-2fa` (pública, pre-sesión). TOTP implementado con stdlib (hmac/
struct/base64), sin dependencias/layer — igual que el JWT de los Authorizers.

[J]: ruta /Security/Totp (authorizer + CORS + mapping template con userId); IAM
`dynamodb:GetItem/UpdateItem user`. Env TOTP_ISSUER (default 'MailConnect').
'''
import os
import json
import time
import struct
import base64
import hmac
import hashlib
import secrets

import boto3

dynamodb = boto3.resource('dynamodb')
table_user = dynamodb.Table('user')

ISSUER = os.environ.get('TOTP_ISSUER', 'MailConnect')
TOTP_STEP = 30
TOTP_DIGITS = 6
TOTP_WINDOW = 1          # ±1 paso (tolerancia de reloj)
BACKUP_CODE_COUNT = 10


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _auth(event):
    return ((event or {}).get('requestContext') or {}).get('authorizer') or {}


# ── TOTP (RFC 6238) con stdlib ────────────────────────────────────────────────
def _b32_secret():
    """Secreto base32 (160 bits) para el authenticator."""
    return base64.b32encode(secrets.token_bytes(20)).decode('ascii').rstrip('=')


def _hotp(secret_b32, counter):
    key = base64.b32decode(secret_b32 + '=' * (-len(secret_b32) % 8), casefold=True)
    digest = hmac.new(key, struct.pack('>Q', counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** TOTP_DIGITS)
    return str(code).zfill(TOTP_DIGITS)


def totp_verify(secret_b32, code, at=None):
    """True si `code` es válido para el secreto en la ventana actual (±TOTP_WINDOW)."""
    code = str(code or '').strip()
    if not code or not secret_b32:
        return False
    counter = int(at if at is not None else time.time()) // TOTP_STEP
    for w in range(-TOTP_WINDOW, TOTP_WINDOW + 1):
        try:
            if hmac.compare_digest(_hotp(secret_b32, counter + w), code):
                return True
        except Exception:
            return False
    return False


def _otpauth_uri(secret, label_email):
    from urllib.parse import quote
    label = quote('{}:{}'.format(ISSUER, label_email))
    return ('otpauth://totp/{label}?secret={secret}&issuer={issuer}&digits={digits}&period={period}'
            ).format(label=label, secret=secret, issuer=quote(ISSUER),
                     digits=TOTP_DIGITS, period=TOTP_STEP)


def _gen_backup_codes():
    """10 códigos de respaldo de un solo uso (formato xxxx-xxxx). Devuelve (planos, hashes)."""
    plains, hashes = [], []
    for _ in range(BACKUP_CODE_COUNT):
        raw = secrets.token_hex(4)            # 8 hex
        code = '{}-{}'.format(raw[:4], raw[4:])
        plains.append(code)
        hashes.append(hashlib.sha256(code.replace('-', '').encode()).hexdigest())
    return plains, hashes


def _resp(status_code, description, data=None):
    return {'status': status_code < 400, 'statusCode': status_code,
            'description': description, 'data': data or {}}


def lambda_handler(event, context):
    payload = _get_payload(event)
    user_id = _auth(event).get('userId')
    if not user_id:
        return _resp(403, 'Sesión sin identidad de usuario.')

    action = str(payload.get('action', 'status') or 'status').lower()

    try:
        item = table_user.get_item(Key={'userId': user_id}).get('Item')
        if not item:
            return _resp(404, 'Usuario no encontrado.')
        enabled = bool(item.get('totpEnabled'))
        email = str(item.get('email', '') or 'usuario')

        if action == 'status':
            return _resp(200, 'Estado del segundo factor',
                         {'enabled': enabled, 'pending': bool(item.get('totpPendingSecret'))})

        if action == 'enroll':
            if enabled:
                return _resp(409, 'El segundo factor ya está activo. Desactívalo antes de volver a configurarlo.')
            secret = _b32_secret()
            table_user.update_item(
                Key={'userId': user_id},
                UpdateExpression='SET totpPendingSecret = :s',
                ExpressionAttributeValues={':s': secret})
            return _resp(200, 'Escanea el código con tu app de autenticación',
                         {'secret': secret, 'otpauthUri': _otpauth_uri(secret, email)})

        if action == 'activate':
            if enabled:
                return _resp(409, 'El segundo factor ya está activo.')
            pending = item.get('totpPendingSecret')
            if not pending:
                return _resp(400, 'Primero genera un código (enroll) y escanéalo.')
            if not totp_verify(pending, payload.get('code')):
                return _resp(401, 'El código no es válido. Verifica la hora de tu dispositivo e intenta de nuevo.')
            plains, hashes = _gen_backup_codes()
            table_user.update_item(
                Key={'userId': user_id},
                UpdateExpression=('SET totpEnabled = :t, totpSecret = :s, totpBackupCodes = :b, '
                                  'totpEnrolledAt = :d REMOVE totpPendingSecret'),
                ExpressionAttributeValues={
                    ':t': True, ':s': pending, ':b': hashes,
                    ':d': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())})
            return _resp(200, 'Segundo factor activado. Guarda tus códigos de respaldo.',
                         {'enabled': True, 'backupCodes': plains})

        if action == 'disable':
            if not enabled:
                return _resp(200, 'El segundo factor ya estaba desactivado.', {'enabled': False})
            code = str(payload.get('code', '') or '').strip()
            ok = totp_verify(item.get('totpSecret'), code)
            # ...o un código de respaldo válido (se consume).
            remaining = list(item.get('totpBackupCodes') or [])
            if not ok and code:
                h = hashlib.sha256(code.replace('-', '').encode()).hexdigest()
                if h in remaining:
                    ok = True
            if not ok:
                return _resp(401, 'Para desactivar el 2FA ingresa un código válido de tu app o uno de respaldo.')
            table_user.update_item(
                Key={'userId': user_id},
                UpdateExpression='SET totpEnabled = :f REMOVE totpSecret, totpBackupCodes, totpPendingSecret, totpEnrolledAt',
                ExpressionAttributeValues={':f': False})
            return _resp(200, 'Segundo factor desactivado.', {'enabled': False})

        return _resp(400, 'Acción inválida (usa status, enroll, activate o disable).')
    except Exception as e:
        print('Error en Security/Totp: {}'.format(e))
        return _resp(500, 'Error no controlado al gestionar el segundo factor.')
