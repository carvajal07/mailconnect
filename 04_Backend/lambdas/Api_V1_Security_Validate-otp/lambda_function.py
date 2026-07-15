import os
import json
import time
import hmac
import hashlib
import boto3
from botocore.exceptions import ClientError

MAX_OTP_ATTEMPTS = int(os.environ.get('MAX_OTP_ATTEMPTS', '5'))


def _register_failed_attempt(table_otp, user_id):
    """Suma 1 a los intentos de los OTP activos del usuario; al superar el máximo,
    los invalida (límite de fuerza bruta sobre el código de 6 dígitos)."""
    kwargs = {
        'FilterExpression': 'userId = :u AND active = :a',
        'ExpressionAttributeValues': {':u': user_id, ':a': True},
        'ProjectionExpression': 'oneTimePasswordId',
    }
    while True:
        resp = table_otp.scan(**kwargs)
        for it in resp.get('Items', []):
            try:
                upd = table_otp.update_item(
                    Key={'oneTimePasswordId': it['oneTimePasswordId']},
                    UpdateExpression='SET attempts = if_not_exists(attempts, :z) + :one',
                    ExpressionAttributeValues={':z': 0, ':one': 1},
                    ReturnValues='UPDATED_NEW')
                if int(upd['Attributes'].get('attempts', 0)) >= MAX_OTP_ATTEMPTS:
                    table_otp.update_item(
                        Key={'oneTimePasswordId': it['oneTimePasswordId']},
                        UpdateExpression='SET active = :f',
                        ExpressionAttributeValues={':f': False})
            except Exception as e:
                print('No se pudo registrar intento fallido: {}'.format(e))
        last = resp.get('LastEvaluatedKey')
        if not last:
            break
        kwargs['ExclusiveStartKey'] = last

dynamodb = boto3.resource('dynamodb')
table_otp = dynamodb.Table('oneTimePassword')
table_user = dynamodb.Table('user')


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _resolve_user_id(payload):
    user_id = payload.get('userId')
    if user_id:
        return user_id
    email = payload.get('user') or payload.get('email')
    if email:
        resp = table_user.scan(
            FilterExpression="email = :v",
            ExpressionAttributeValues={":v": email},
            ProjectionExpression='userId'
        )
        if resp['Items']:
            return resp['Items'][0]['userId']
    return None


def lambda_handler(event, context):
    payload = _get_payload(event)

    otp = payload.get('otp')
    if otp is None:
        return {'status': False, 'statusCode': 400, 'description': "Falta el código OTP"}

    try:
        user_id = _resolve_user_id(payload)
        if not user_id:
            return {'status': False, 'statusCode': 404, 'description': "Usuario no encontrado"}

        otp_hash = hashlib.sha256(str(otp).encode()).hexdigest()
        now = int(time.time())

        # Buscar el OTP activo del usuario (paginado, para no perderlo si la tabla
        # supera 1 MB) comparando el hash de forma timing-safe.
        matched = None
        kwargs = {
            'FilterExpression': "userId = :u AND active = :a",
            'ExpressionAttributeValues': {":u": user_id, ":a": True},
            'ProjectionExpression': 'oneTimePasswordId, otpHash, expirationTime'
        }
        while matched is None:
            response = table_otp.scan(**kwargs)
            for item in response.get('Items', []):
                if hmac.compare_digest(str(item.get('otpHash', '')), otp_hash):
                    matched = item
                    break
            last = response.get('LastEvaluatedKey')
            if matched is not None or not last:
                break
            kwargs['ExclusiveStartKey'] = last

        if matched is None:
            # Código incorrecto: cuenta el intento (y bloquea al superar el máximo).
            _register_failed_attempt(table_otp, user_id)
            return {'status': False, 'statusCode': 401, 'description': "Código OTP inválido"}

        if int(matched.get('expirationTime', 0)) <= now:
            return {'status': False, 'statusCode': 410, 'description': "El código ha expirado"}

        # Válido: consumir el OTP de forma atómica (evita doble uso concurrente).
        try:
            table_otp.update_item(
                Key={'oneTimePasswordId': matched['oneTimePasswordId']},
                UpdateExpression='SET active = :f',
                ConditionExpression='active = :t',
                ExpressionAttributeValues={':f': False, ':t': True}
            )
        except ClientError as ce:
            if ce.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException':
                return {'status': False, 'statusCode': 401, 'description': "Código OTP inválido"}
            raise

        return {
            'status': True,
            'statusCode': 200,
            'description': "OTP válido",
            'data': {'userId': user_id, 'valid': True}
        }
    except Exception as e:
        print("Error en validate-otp: {}".format(e))
        return {'status': False, 'statusCode': 500, 'description': "Error no controlado en el servicio"}
