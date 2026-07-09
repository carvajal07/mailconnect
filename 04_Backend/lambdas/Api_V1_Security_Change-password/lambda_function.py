import os
import re
import json
import uuid
import time
import hashlib
import boto3

try:
    import jwt  # PyJWT (mismo que usa Login)
except ImportError:
    jwt = None

dynamodb = boto3.resource('dynamodb')
table_user = dynamodb.Table('user')
table_otp = dynamodb.Table('otp')

SECRET_KEY = os.environ.get('SECRET_KEY', '')


def _get_payload(event):
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
    response = table_otp.scan(
        FilterExpression="userId = :u AND active = :a",
        ExpressionAttributeValues={":u": user_id, ":a": True},
        ProjectionExpression='otpId, otpHash, expirationTime'
    )
    for item in response['Items']:
        if item.get('otpHash') == otp_hash and int(item.get('expirationTime', 0)) > now:
            # Consumir el OTP
            table_otp.update_item(
                Key={'otpId': item['otpId']},
                UpdateExpression='SET active = :f',
                ExpressionAttributeValues={':f': False}
            )
            return True
    return False


def lambda_handler(event, context):
    status = True
    statusCode = 200
    description = "Contraseña actualizada correctamente"

    payload = _get_payload(event)

    try:
        email = payload['user']
        new_password = payload['password']
        otp = payload.get('otp')
    except Exception:
        return {'status': False, 'statusCode': 400, 'description': "Faltan campos requeridos (user, password)"}

    try:
        user = _find_user_by_email(email)
        if not user:
            return {'status': False, 'statusCode': 404, 'description': "Usuario no encontrado"}

        # Validar la contraseña ANTES de autorizar. El camino por OTP consume el
        # código durante la autorización, así que si la clave es débil rechazamos
        # primero y el OTP sigue disponible para reintentar.
        if not _valid_password(new_password):
            return {'status': False, 'statusCode': 400,
                    'description': "La contraseña no cumple los requisitos mínimos (8+ caracteres, mayúscula, minúscula y número)."}

        # Autorización: token de sesión O un OTP válido (recuperación)
        authorized = _authorized_by_token(event, payload, email) or _authorized_by_otp(user['userId'], otp)
        if not authorized:
            return {'status': False, 'statusCode': 401,
                    'description': "No autorizado. Se requiere sesión válida o un OTP correcto."}

        # Nuevo salt + hash
        salt = str(uuid.uuid4())
        hashed = hashlib.sha256((new_password + salt).encode()).hexdigest()

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

    return {'status': status, 'statusCode': statusCode, 'description': description}
