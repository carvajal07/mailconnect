import os
import re
import json
import uuid
import time
import hashlib
import hmac
import boto3
from botocore.exceptions import ClientError

try:
    import jwt  # PyJWT (mismo que usa Login)
except ImportError:
    jwt = None

dynamodb = boto3.resource('dynamodb')
table_user = dynamodb.Table('user')
table_otp = dynamodb.Table('oneTimePassword')

SECRET_KEY = os.environ.get('SECRET_KEY', '')

# Headers de la respuesta. Con integración Lambda-proxy, API Gateway NO agrega
# CORS ni Content-Type por su cuenta: los debe poner la Lambda.
_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
}


PBKDF2_ITERATIONS = int(os.environ.get('PBKDF2_ITERATIONS', '100000'))


def _hash_password(password, salt):
    """PBKDF2-HMAC-SHA256 (stdlib, sin dependencias/layer). Formato auto-descriptivo
    'pbkdf2$<iter>$<hex>'. Reemplaza el SHA-256 de una sola pasada (débil ante GPU)."""
    dk = hashlib.pbkdf2_hmac('sha256', str(password).encode(), str(salt).encode(), PBKDF2_ITERATIONS)
    return 'pbkdf2${}${}'.format(PBKDF2_ITERATIONS, dk.hex())


def _verify_password(password, stored_hash, salt):
    """Verifica contra el hash nuevo (pbkdf2) o el viejo (sha256), timing-safe."""
    stored = str(stored_hash or '')
    if stored.startswith('pbkdf2$'):
        try:
            _, iters, hexhash = stored.split('$', 2)
            dk = hashlib.pbkdf2_hmac('sha256', str(password).encode(), str(salt).encode(), int(iters))
            return hmac.compare_digest(dk.hex(), hexhash)
        except Exception:
            return False
    legacy = hashlib.sha256((str(password) + str(salt)).encode()).hexdigest()
    return hmac.compare_digest(legacy, stored)


def _is_legacy_hash(stored_hash):
    return not str(stored_hash or '').startswith('pbkdf2$')


def _reply(status, statusCode, description):
    """Respuesta con forma DUAL:
    - campos de nivel superior (status/statusCode/description) para invocación
      directa e integración no-proxy (y para las pruebas), y
    - 'statusCode' + 'body' (string) + 'headers' para integración Lambda-proxy,
      que exige exactamente ese formato (si no, API Gateway responde 502).
    """
    return {
        'status': status,
        'statusCode': statusCode,
        'description': description,
        'headers': _HEADERS,
        'body': json.dumps({'status': status, 'statusCode': statusCode, 'description': description}),
    }


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


def _get_headers(event):
    headers = {}
    if isinstance(event, dict):
        raw = event.get('headers') or {}
        for k, v in raw.items():
            headers[str(k).lower()] = v
    return headers


def _find_user_by_email(email):
    response = table_user.scan(
        FilterExpression="email = :value",
        ExpressionAttributeValues={":value": email},
        ProjectionExpression='userId, email'
    )
    return response['Items'][0] if response['Items'] else None


def _valid_password(password):
    """Reglas mínimas de contraseña (coinciden con el front)."""
    if not password or len(password) < 8:
        return False
    if not re.search(r'[a-z]', password):
        return False
    if not re.search(r'[A-Z]', password):
        return False
    if not re.search(r'\d', password):
        return False
    return True


def _authorized_by_token(event, payload, email):
    """Cambio autenticado: usuario logueado con un JWT válido a su propio nombre."""
    if not jwt or not SECRET_KEY:
        return False
    headers = _get_headers(event)
    raw = headers.get('authorization') or payload.get('token') or ''
    if not raw:
        return False
    token = raw.split(' ')[1] if raw.lower().startswith('bearer ') else raw
    try:
        decoded = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        return decoded.get('user') == email
    except Exception:
        return False


def _authorized_by_otp(user_id, otp):
    """Cambio por recuperación: valida y consume un OTP activo y no expirado."""
    if otp is None:
        return False
    otp_hash = hashlib.sha256(str(otp).encode()).hexdigest()
    now = int(time.time())
    kwargs = {
        'FilterExpression': "userId = :u AND active = :a",
        'ExpressionAttributeValues': {":u": user_id, ":a": True},
        'ProjectionExpression': 'oneTimePasswordId, otpHash, expirationTime'
    }
    while True:
        response = table_otp.scan(**kwargs)
        for item in response.get('Items', []):
            if (hmac.compare_digest(str(item.get('otpHash', '')), otp_hash)
                    and int(item.get('expirationTime', 0)) > now):
                # Consumir el OTP de forma atómica (evita doble uso concurrente).
                try:
                    table_otp.update_item(
                        Key={'oneTimePasswordId': item['oneTimePasswordId']},
                        UpdateExpression='SET active = :f',
                        ConditionExpression='active = :t',
                        ExpressionAttributeValues={':f': False, ':t': True}
                    )
                    return True
                except ClientError as ce:
                    if ce.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException':
                        return False
                    raise
        last = response.get('LastEvaluatedKey')
        if not last:
            return False
        kwargs['ExclusiveStartKey'] = last


def lambda_handler(event, context):
    status = True
    statusCode = 200
    description = "Contraseña actualizada correctamente"

    payload = _get_payload(event)

    try:
        email = str(payload['user']).strip().lower()
        new_password = payload['password']
        otp = payload.get('otp')
    except Exception:
        return _reply(False, 400, "Faltan campos requeridos (user, password)")

    try:
        user = _find_user_by_email(email)
        if not user:
            return _reply(False, 404, "Usuario no encontrado")

        # Validar la contraseña ANTES de autorizar. El camino por OTP consume el
        # código durante la autorización, así que si la clave es débil rechazamos
        # primero y el OTP sigue disponible para reintentar.
        if not _valid_password(new_password):
            return _reply(False, 400,
                          "La contraseña no cumple los requisitos mínimos (8+ caracteres, mayúscula, minúscula y número).")

        # Autorización: token de sesión O un OTP válido (recuperación)
        authorized = _authorized_by_token(event, payload, email) or _authorized_by_otp(user['userId'], otp)
        if not authorized:
            return _reply(False, 401,
                          "No autorizado. Se requiere sesión válida o un OTP correcto.")

        # Nuevo salt + hash (PBKDF2)
        salt = str(uuid.uuid4())
        hashed = _hash_password(new_password, salt)

        table_user.update_item(
            Key={'userId': user['userId']},
            UpdateExpression='SET userHash = :h, userSalt = :s',
            ExpressionAttributeValues={':h': hashed, ':s': salt}
        )
    except Exception as e:
        print("Error en change-password: {}".format(e))
        status = False
        statusCode = 500
        description = "Error no controlado en el servicio"

    return _reply(status, statusCode, description)
