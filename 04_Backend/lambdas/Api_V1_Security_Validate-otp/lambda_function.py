import json
import time
import hashlib
import boto3

dynamodb = boto3.resource('dynamodb')
table_otp = dynamodb.Table('oneTimePassword')
table_user = dynamodb.Table('user')


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

        response = table_otp.scan(
            FilterExpression="userId = :u AND active = :a",
            ExpressionAttributeValues={":u": user_id, ":a": True},
            ProjectionExpression='oneTimePasswordId, otpHash, expirationTime'
        )

        for item in response['Items']:
            if item.get('otpHash') == otp_hash:
                if int(item.get('expirationTime', 0)) <= now:
                    return {'status': False, 'statusCode': 410, 'description': "El código ha expirado"}
                # Válido: consumir el OTP
                table_otp.update_item(
                    Key={'oneTimePasswordId': item['oneTimePasswordId']},
                    UpdateExpression='SET active = :f',
                    ExpressionAttributeValues={':f': False}
                )
                return {
                    'status': True,
                    'statusCode': 200,
                    'description': "OTP válido",
                    'data': {'userId': user_id, 'valid': True}
                }

        return {'status': False, 'statusCode': 401, 'description': "Código OTP inválido"}
    except Exception as e:
        print("Error en validate-otp: {}".format(e))
        return {'status': False, 'statusCode': 500, 'description': "Error no controlado en el servicio"}
