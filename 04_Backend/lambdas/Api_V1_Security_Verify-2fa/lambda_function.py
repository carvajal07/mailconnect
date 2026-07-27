'''
Segundo paso del LOGIN con 2FA (Bloque I). Recibe el DESAFÍO que emitió Login (tras la
contraseña correcta) + el código TOTP (o de respaldo) y, si es válido, crea la sesión y
emite el JWT real — igual que Login en su camino sin 2FA.

Ruta: POST /Security/Verify-2fa   (integración NO-proxy, envelope; SIN authorizer, es
pre-sesión como Login)
Request: { challenge, code }   code = 6 dígitos del authenticator o un código de respaldo.
Respuesta: 200 `data:{token, customer, customerId, ...}` (idéntico a Login OK) ·
           401 código inválido / desafío inválido o vencido · 429 demasiados intentos.

Protección de fuerza bruta: el contador `twofaFails` del usuario limita los intentos por
código; a los MAX_2FA_ATTEMPTS fallos se responde 429 y el desafío deja de aceptarse (hay
que volver a iniciar sesión). Un ingreso correcto resetea el contador y CONSUME el código de
respaldo si se usó uno.

Env: SECRET_KEY (misma del JWT), TOTP_ISSUER opcional.
[J]: ruta pública /Security/Verify-2fa (no-proxy, sin authorizer, CORS); IAM
`dynamodb:GetItem/UpdateItem user`, `GetItem customer`, `GetItem userData`, `PutItem session`,
`PutItem adminAudit`.
'''
import os
import time
import uuid
import json
import struct
import base64
import hmac
import hashlib

import jwt
import boto3
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
table_user = dynamodb.Table('user')
table_customer = dynamodb.Table('customer')
table_user_data = dynamodb.Table('userData')
table_session = dynamodb.Table('session')
_audit_table = dynamodb.Table('adminAudit')

SECRET_KEY = os.environ['SECRET_KEY']
JWT_TTL_SECONDS = 24 * 60 * 60
TOTP_STEP = 30
TOTP_DIGITS = 6
TOTP_WINDOW = 1
MAX_2FA_ATTEMPTS = int(os.environ.get('MAX_2FA_ATTEMPTS', '5'))


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _audit(action, actor, detail, customer='', target=''):
    try:
        _audit_table.put_item(Item={
            'auditId': str(uuid.uuid4()), 'action': action, 'actor': str(actor or 'desconocido'),
            'actorId': '', 'customer': str(customer or ''), 'target': str(target or actor or ''),
            'detail': str(detail), 'date': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())})
    except Exception as e:
        print('No se pudo registrar auditoría: {}'.format(e))


# ── TOTP (RFC 6238) con stdlib (idéntico a Api_V1_Security_Totp) ──────────────
def _hotp(secret_b32, counter):
    key = base64.b32decode(secret_b32 + '=' * (-len(secret_b32) % 8), casefold=True)
    digest = hmac.new(key, struct.pack('>Q', counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** TOTP_DIGITS)
    return str(code).zfill(TOTP_DIGITS)


def _totp_verify(secret_b32, code, at=None):
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


def _client_info(event):
    ip, device = 'unknown', 'unknown'
    if isinstance(event, dict):
        identity = (event.get('requestContext') or {}).get('identity') or {}
        ip = identity.get('sourceIp') or event.get('ip') or event.get('sourceIp') or ip
        for k, v in (event.get('headers') or {}).items():
            lk = str(k).lower()
            if lk == 'user-agent' and v:
                device = v
            elif ip == 'unknown' and lk == 'x-forwarded-for' and v:
                ip = str(v).split(',')[0].strip()
    return ip, device


def generate_jwt(username, customer_id='', customer='', user_id='', role='client',
                 nit='', tenant_role='owner', session_id=''):
    now_ts = int(time.time())
    payload = {'user': username, 'customerId': customer_id, 'customer': customer,
               'nit': str(nit or ''), 'userId': user_id, 'role': role,
               'tenantRole': tenant_role or 'owner', 'sid': str(session_id or ''),
               'iat': now_ts, 'exp': now_ts + JWT_TTL_SECONDS}
    token = jwt.encode(payload, SECRET_KEY, algorithm='HS256')
    return token.decode('utf-8') if isinstance(token, bytes) else token


def _select_client(customer_id):
    item = table_customer.get_item(
        Key={'customerId': customer_id},
        ProjectionExpression='company, companyTin, realSendEnabled, featureFlags').get('Item') or {}
    flags = item.get('featureFlags') or {}
    flags = {str(k): bool(v) for k, v in flags.items()} if isinstance(flags, dict) else {}
    return (item.get('company', ''), item.get('companyTin', ''),
            bool(item.get('realSendEnabled', True)), flags)


def _select_name(user_data_id):
    item = table_user_data.get_item(
        Key={'userDataId': user_data_id}, ProjectionExpression='userName').get('Item') or {}
    return item.get('userName', '')


def _fail(status_code, description):
    return {'status': False, 'statusCode': status_code, 'description': description,
            'data': {'token': '', 'twofaRequired': True}}


def lambda_handler(event, context):
    payload = _get_payload(event)
    challenge = str(payload.get('challenge', '') or '')
    code = str(payload.get('code', '') or '').strip()
    if not challenge or not code:
        return _fail(400, 'Faltan el desafío o el código.')

    # 1) Validar el desafío firmado por Login (corto, claim twofa=True).
    try:
        claims = jwt.decode(challenge, SECRET_KEY, algorithms=['HS256'])
    except jwt.ExpiredSignatureError:
        return _fail(401, 'El tiempo para ingresar el código expiró. Inicia sesión de nuevo.')
    except Exception:
        return _fail(401, 'Desafío inválido. Inicia sesión de nuevo.')
    if not claims.get('twofa') or not claims.get('userId'):
        return _fail(401, 'Desafío inválido. Inicia sesión de nuevo.')
    user_id = claims['userId']

    try:
        item = table_user.get_item(Key={'userId': user_id}).get('Item')
        if not item or not item.get('totpEnabled'):
            return _fail(401, 'La verificación no está disponible para esta cuenta.')

        # Tope de intentos por fuerza bruta del código.
        try:
            fails = int(item.get('twofaFails', 0) or 0)
        except (TypeError, ValueError):
            fails = 0
        if fails >= MAX_2FA_ATTEMPTS:
            _audit('security.2fa.lockout', item.get('email', ''),
                   'Demasiados códigos 2FA inválidos')
            return _fail(429, 'Demasiados intentos. Inicia sesión de nuevo.')

        # 2) Verificar el código: TOTP o un código de respaldo (de un solo uso).
        ok = _totp_verify(item.get('totpSecret'), code)
        backup = list(item.get('totpBackupCodes') or [])
        used_backup = False
        if not ok:
            h = hashlib.sha256(code.replace('-', '').encode()).hexdigest()
            if h in backup:
                ok = True
                used_backup = True
                backup.remove(h)

        if not ok:
            # Cuenta el fallo (atómico) y niega.
            try:
                table_user.update_item(
                    Key={'userId': user_id},
                    UpdateExpression='ADD twofaFails :one',
                    ExpressionAttributeValues={':one': 1})
            except Exception as e:
                print('No se pudo contar el intento 2FA ({})'.format(e))
            _audit('security.2fa.fail', item.get('email', ''), 'Código 2FA inválido')
            return _fail(401, 'Código incorrecto. Verifica la hora de tu dispositivo e intenta de nuevo.')

        # 3) Éxito → limpiar contador (+ consumir el código de respaldo si se usó) y
        #    finalizar el ingreso como Login: sesión + token.
        update_expr = 'SET twofaFails = :z'
        values = {':z': 0}
        if used_backup:
            update_expr += ', totpBackupCodes = :b'
            values[':b'] = backup
        try:
            table_user.update_item(Key={'userId': user_id},
                                   UpdateExpression=update_expr, ExpressionAttributeValues=values)
        except Exception as e:
            print('No se pudo actualizar el usuario tras 2FA ({})'.format(e))

        user = str(item.get('email', ''))
        customer_id = item.get('customerId', '')
        role = item.get('role', 'client') or 'client'
        tenant_role = item.get('tenantRole', 'owner') or 'owner'
        company, company_tin, real_send, flags = _select_client(customer_id)
        name = _select_name(item.get('userDataId'))

        ip, device = _client_info(event)
        session_id = str(uuid.uuid4())
        try:
            table_session.put_item(Item={
                'sessionId': session_id, 'userId': user_id, 'ipAddress': ip, 'device': device,
                'numberAttemps': 1, 'active': True,
                'date': datetime.now().strftime('%Y-%m-%d %H:%M:%S')})
        except Exception as e:
            print('No se pudo registrar la sesión ({})'.format(e))
            return _fail(500, 'No se pudo iniciar la sesión. Intenta de nuevo.')

        token = generate_jwt(user, customer_id, company, user_id, role,
                             company_tin, tenant_role, session_id)
        _audit('security.2fa.success',
               user, 'Ingreso con 2FA {}(IP {})'.format('(código de respaldo) ' if used_backup else '', ip),
               company, user_id)

        return {
            'status': True, 'statusCode': 200, 'description': 'Usuario correcto',
            'data': {
                'token': token, 'customer': company, 'customerId': customer_id,
                'companyTin': str(company_tin) if company_tin != '' else '',
                'userId': user_id, 'name': name, 'realSendEnabled': real_send,
                'role': role, 'tenantRole': tenant_role, 'featureFlags': flags,
                'twofaRequired': False, 'backupCodesRemaining': len(backup),
            }
        }
    except Exception as e:
        print('Error en Verify-2fa: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado en la verificación', 'data': {'token': ''}}
