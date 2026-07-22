import os
import re
import boto3
import uuid
from datetime import datetime

# Inicializar el cliente SES
ses_client = boto3.client('ses', region_name=os.environ.get('SES_REGION', 'us-east-1'))
# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')

table_templateAudit = dynamodb.Table('templateAudit')


def _ses_safe(s):
    """SES exige que TemplateName solo tenga [A-Za-z0-9_-]. Create-template sanea el
    nombre así al crearlo, por lo que la verificación de propiedad usa el MISMO saneo
    sobre el prefijo del cliente para que siga coincidiendo."""
    return re.sub(r'[^A-Za-z0-9_-]+', '_', str(s)).strip('_') or 'plantilla'


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def _owns_template(event, template_name):
    """Verifica que la plantilla pertenezca al tenant del token.
    Convención de nombre: '{customer}_{consecutivo}_{nombre}' (cliente saneado).
    Si el Authorizer trae 'customer', se exige el prefijo saneado '{customer}_'.
    Sin contexto del Authorizer (token) se DENIEGA (multi-tenant obligatorio)."""
    customer = str(_authorizer(event).get('customer', '')).strip()
    if customer:
        return str(template_name).startswith('{}_'.format(_ses_safe(customer)))
    return False  # sin context del token: denegar


def lambda_handler(event, context):

    # Compat mapping template no-proxy: si el payload llega como
    # {body:{...}, requestContext:{...}}, se aplana el body al nivel de event
    # (preservando requestContext para el context del Authorizer). Si ya viene
    # plano (passthrough legacy), no hace nada.
    if isinstance(event, dict) and isinstance(event.get("body"), dict):
        _rc = event.get("requestContext")
        event = dict(event["body"])
        if _rc:
            event["requestContext"] = _rc
    status = True
    description = "Plantilla eliminada correctamente"
    statusCode = 200

    try:
        # Obtener datos del evento (userId del token si viene; si no, del body)
        userId = _authorizer(event).get('userId') or event['userId']
        templateName = event['templateName']
    except Exception:
        return {
            'status': False,
            'statusCode': 400,
            'description': 'Faltan datos obligatorios',
        }

    if not _owns_template(event, templateName):
        return {
            'status': False,
            'statusCode': 403,
            'description': 'La plantilla no pertenece a tu cuenta.',
        }

    # Eliminar la plantilla de correo electrónico
    try:
        ses_client.delete_template(TemplateName=templateName)
        print("plantilla eliminada correctamente")

        templateAuditId = str(uuid.uuid4())
        now = datetime.utcnow()
        formattedDate = now.strftime("%Y-%m-%d %H:%M:%S")

        table_templateAudit.put_item(
            Item={
                'templateAuditId': templateAuditId,
                'userId': userId,
                'templateName': templateName,
                'action': 'Delete',
                'date': formattedDate
            }
        )
    except Exception as e:
        print(e)
        status = False
        statusCode = 500
        description = "Error no controlado en el servicio"

    return {
        'status': status,
        'statusCode': statusCode,
        'description': description,
    }
