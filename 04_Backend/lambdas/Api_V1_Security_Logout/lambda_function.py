import json
import boto3

dynamodb = boto3.resource('dynamodb')
table_session = dynamodb.Table('session')
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
    """
    Cierra la sesión del usuario marcando como inactivas sus sesiones en la tabla
    'session'. Nota: el token JWT es stateless (expira solo por 'exp'); para una
    invalidación inmediata del token habría que llevar una lista de revocación y
    consultarla en el Authorizer. El front, además, elimina el token localmente.
    """
    payload = _get_payload(event)

    try:
        user_id = _resolve_user_id(payload)
        if not user_id:
            # No revelamos si el usuario existe; el logout es idempotente.
            return {'status': True, 'statusCode': 200, 'description': "Sesión cerrada"}

        response = table_session.scan(
            FilterExpression="userId = :u AND active = :a",
            ExpressionAttributeValues={":u": user_id, ":a": True},
            ProjectionExpression='sessionId'
        )

        closed = 0
        for item in response['Items']:
            table_session.update_item(
                Key={'sessionId': item['sessionId']},
                UpdateExpression='SET active = :f',
                ExpressionAttributeValues={':f': False}
            )
            closed += 1

        return {
            'status': True,
            'statusCode': 200,
            'description': "Sesión cerrada",
            'data': {'closedSessions': closed}
        }
    except Exception as e:
        print("Error en logout: {}".format(e))
        # Aun con error, el front ya limpió el token; respondemos OK idempotente.
        return {'status': True, 'statusCode': 200, 'description': "Sesión cerrada"}
