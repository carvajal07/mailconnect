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

import jwt

SECRET_KEY = os.environ.get('SECRET_KEY', '')
# Duración del nuevo token (días). Igual que Login por defecto.
TOKEN_TTL_DAYS = int(os.environ.get('TOKEN_TTL_DAYS', '1'))


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

    # Reemitir con los mismos claims (incluido el rol) y un exp fresco.
    # exp/iat como timestamp entero (robusto entre versiones de PyJWT).
    now_ts = int(time.time())
    new_payload = {
        'user': decoded.get('user', ''),
        'customerId': decoded.get('customerId', ''),
        'customer': decoded.get('customer', ''),
        'userId': decoded.get('userId', ''),
        'role': decoded.get('role', 'client'),
        'iat': now_ts,
        'exp': now_ts + TOKEN_TTL_DAYS * 24 * 60 * 60,
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
