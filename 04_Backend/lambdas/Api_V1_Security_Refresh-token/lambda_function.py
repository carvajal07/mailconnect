'''
Lambda para renovar el JWT (refresh token).

Ruta: POST /Security/Refresh-token   (con Authorizer)
Recibe el token vigente (por header Authorization: Bearer, o en el body como
`token`, para soportar integración no-proxy) y, si es válido y no ha expirado,
emite uno NUEVO con los mismos claims (user, customerId, customer, userId) y un
`exp` fresco. Así la sesión se extiende sin volver a pedir credenciales.

No es un refresh token "de verdad" (no hay token de larga duración aparte): es una
renovación deslizante mientras el token actual siga vigente. Si ya expiró, hay que
volver a iniciar sesión (401).

Env: SECRET_KEY (la misma de Login/Authorizers).
'''
import os
import json
import time
from datetime import datetime, timedelta

import boto3
import jwt

SECRET_KEY = os.environ.get('SECRET_KEY', '')
# Duración del nuevo token (días). Igual que Login por defecto.
TOKEN_TTL_DAYS = int(os.environ.get('TOKEN_TTL_DAYS', '1'))
# Vida MÁXIMA absoluta de una sesión (días): tope al refresco deslizante infinito.
MAX_SESSION_DAYS = int(os.environ.get('MAX_SESSION_DAYS', '30'))

dynamodb = boto3.resource('dynamodb')
table_user = dynamodb.Table('user')
table_session = dynamodb.Table('session')


def _session_active(sid):
    """¿La sesión del token existe y sigue activa? (revocación server-side, ver
    Authorizer). Ante error de lectura DENIEGA: no se renueva un token dudoso."""
    try:
        item = table_session.get_item(Key={'sessionId': str(sid)}).get('Item')
    except Exception as e:
        print('Refresh-token: no se pudo leer la sesión: {}'.format(e))
        return False
    return bool(item) and bool(item.get('active'))


def _get_payload(event):
    # API Gateway (mapping template) puede inyectar el body como OBJETO JSON
    # (integración no-proxy) o como STRING (proxy). Se aceptan ambos.
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _extract_token(event, payload):
    """Token desde el header Authorization o desde el body ('token')."""
    raw = ''
    if isinstance(event, dict):
        headers = event.get('headers') or {}
        for key, value in headers.items():
            if str(key).lower() == 'authorization' and value:
                raw = value
                break
    if not raw:
        raw = payload.get('token') or payload.get('Authorization') or ''
    raw = (raw or '').strip()
    if raw.lower().startswith('bearer '):
        raw = raw[7:].strip()
    return raw


def lambda_handler(event, context):
    if not SECRET_KEY:
        print('Refresh-token: SECRET_KEY no configurada.')
        return {'status': False, 'statusCode': 500, 'description': 'Servicio no disponible.'}

    payload = _get_payload(event)
    token = _extract_token(event, payload)
    if not token:
        return {'status': False, 'statusCode': 401, 'description': 'Falta el token de sesión.'}

    try:
        decoded = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
    except jwt.ExpiredSignatureError:
        return {'status': False, 'statusCode': 401,
                'description': 'La sesión expiró. Inicia sesión nuevamente.'}
    except Exception as e:
        print('Refresh-token: token inválido: {}'.format(e))
        return {'status': False, 'statusCode': 401, 'description': 'Token inválido.'}

    # Revocación: el token debe traer su sesión (`sid`) y esta debe seguir activa
    # (logout / cambio de contraseña la desactivan). Tokens sin `sid` → re-login.
    sid = decoded.get('sid')
    if not sid or not _session_active(sid):
        return {'status': False, 'statusCode': 401,
                'description': 'La sesión fue cerrada. Inicia sesión nuevamente.'}

    now = int(time.time())
    # Vida máxima absoluta: se preserva el iat original a través de los refrescos;
    # pasado el tope, hay que volver a iniciar sesión (no refresco infinito).
    orig_iat = decoded.get('iat')
    if orig_iat is not None and (now - int(orig_iat)) > MAX_SESSION_DAYS * 86400:
        return {'status': False, 'statusCode': 401,
                'description': 'La sesión alcanzó su duración máxima. Inicia sesión nuevamente.'}

    # Revalidar contra la base: un usuario desactivado o con el rol/sub-rol cambiado
    # NO debe conservar sus claims viejos indefinidamente.
    role = decoded.get('role', 'client')
    # PRESERVAR el sub-rol (tenantRole) en el refresco: si se omitiera, el Authorizer
    # aplicaría su default 'owner' y un operator quedaría ESCALADO a owner al renovar.
    tenant_role = decoded.get('tenantRole', 'owner') or 'owner'
    user_id = decoded.get('userId', '')
    if user_id:
        try:
            user_item = table_user.get_item(
                Key={'userId': user_id},
                ProjectionExpression='active, #r, tenantRole',
                ExpressionAttributeNames={'#r': 'role'}).get('Item')
        except Exception as e:
            print('Refresh-token: no se pudo releer el usuario: {}'.format(e))
            user_item = None
        if user_item is not None:
            if not user_item.get('active', False):
                return {'status': False, 'statusCode': 401,
                        'description': 'La cuenta está inactiva. Inicia sesión nuevamente.'}
            role = user_item.get('role', role) or role
            tenant_role = user_item.get('tenantRole', tenant_role) or tenant_role

    # Reemitir con los mismos claims (rol/sub-rol refrescados), iat y sid preservados
    # y exp fresco.
    new_payload = {
        'user': decoded.get('user', ''),
        'customerId': decoded.get('customerId', ''),
        'customer': decoded.get('customer', ''),
        'nit': decoded.get('nit', ''),   # llave de recursos por cliente: preservar en el refresco
        'userId': user_id,
        'role': role,
        'tenantRole': tenant_role,
        'sid': str(sid),                 # misma sesión: el logout la revoca junto al token
        'iat': int(orig_iat) if orig_iat is not None else now,
        'exp': datetime.utcnow() + timedelta(days=TOKEN_TTL_DAYS),
    }
    new_token = jwt.encode(new_payload, SECRET_KEY, algorithm='HS256')
    if not isinstance(new_token, str):
        new_token = new_token.decode()

    return {
        'status': True,
        'statusCode': 200,
        'description': 'Token renovado',
        'data': {'token': new_token},
    }
