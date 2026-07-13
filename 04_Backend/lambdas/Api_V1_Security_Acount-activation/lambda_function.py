import os
import boto3
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
table_activation = dynamodb.Table('userActivation')
table_user = dynamodb.Table('user')

# URLs de redirección (ajustables por variable de entorno). Apuntan a la página del portal
# /cuenta-activada?estado=ok|error|expirado, que muestra un mensaje claro (antes iba a la
# landing sin decir nada). ⚠️ [J]: fijar estas env con el dominio real del portal.
_APP = os.environ.get('APP_BASE_URL', 'https://www.mailconnect.com.co')
SUCCESS_URL = os.environ.get('ACTIVATION_SUCCESS_URL', _APP + '/cuenta-activada?estado=ok')
ERROR_URL = os.environ.get('ACTIVATION_ERROR_URL', _APP + '/cuenta-activada?estado=error')
EXPIRED_URL = os.environ.get('ACTIVATION_EXPIRED_URL', _APP + '/cuenta-activada?estado=expirado')


def _redirect(location):
    # Respuesta con forma de Lambda-proxy (AWS_PROXY): API Gateway la traduce a un
    # 302 HTTP real con el header Location. El campo 'body' vacío es obligatorio para
    # que el proxy no falle; sin proxy, este mismo dict se mostraría como JSON (no
    # redirige) -> el endpoint DEBE tener activada "Use Lambda Proxy integration".
    return {
        "statusCode": 302,
        "headers": {"Location": location},
        "body": "",
    }


def _get_key(event):
    """Toma la clave de activación de ?qs=... o del path /verify-email/{token}."""
    if not isinstance(event, dict):
        return None
    qsp = event.get('queryStringParameters') or {}
    if qsp.get('qs'):
        return qsp['qs']
    pp = event.get('pathParameters') or {}
    if pp.get('token'):
        return pp['token']
    return None


def lambda_handler(event, context):
    print(event)

    activation_key = _get_key(event)
    if not activation_key:
        return _redirect(ERROR_URL)

    try:
        # Buscar el registro de activación por su clave
        response = table_activation.scan(
            FilterExpression="activationKey = :k",
            ExpressionAttributeValues={":k": activation_key},
            ProjectionExpression='userActivationId, userId, expirationTime, used'
        )

        if not response['Items']:
            return _redirect(ERROR_URL)

        item = response['Items'][0]

        # Ya usado
        if item.get('used'):
            return _redirect(SUCCESS_URL)

        # Verificar expiración (ISO 'YYYY-MM-DDTHH:MM:SSZ' en UTC)
        try:
            exp = datetime.strptime(item['expirationTime'], '%Y-%m-%dT%H:%M:%SZ')
        except Exception:
            exp = None

        if exp is not None and datetime.utcnow() > exp:
            return _redirect(EXPIRED_URL)

        # Activar la cuenta del usuario
        table_user.update_item(
            Key={'userId': item['userId']},
            UpdateExpression='SET #a = :t',
            ExpressionAttributeNames={'#a': 'active'},
            ExpressionAttributeValues={':t': True}
        )

        # Marcar la activación como usada
        table_activation.update_item(
            Key={'userActivationId': item['userActivationId']},
            UpdateExpression='SET used = :t',
            ExpressionAttributeValues={':t': True}
        )

        return _redirect(SUCCESS_URL)

    except Exception as e:
        print("Error en account-activation: {}".format(e))
        return _redirect(ERROR_URL)
