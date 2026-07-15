import os
import boto3
import uuid
from datetime import datetime

# Inicializar el cliente SES
ses_client = boto3.client('ses', region_name=os.environ.get('SES_REGION', 'us-east-1'))
# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')

table_templateAudit = dynamodb.Table('templateAudit')

STRICT_TENANT = os.environ.get('STRICT_TENANT', 'false').strip().lower() == 'true'


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def _owns_template(event, template_name):
    """Verifica que la plantilla pertenezca al tenant del token.
    Convención de nombre: '{customer}_{consecutivo}_{canal}_{nombre}'.
    Si el Authorizer trae 'customer', se exige el prefijo '{customer}_'.
    Sin contexto del Authorizer se permite (legacy) salvo STRICT_TENANT=true."""
    customer = str(_authorizer(event).get('customer', '')).strip()
    if customer:
        return str(template_name).startswith('{}_'.format(customer))
    return not STRICT_TENANT


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
    description = "Plantilla recuperada correctamente"
    statusCode = 200
    responseTemplate = None

    try:
        # Obtener datos del evento (userId del token si viene; si no, del body)
        userId = _authorizer(event).get('userId') or event['userId']
        templateName = event['templateName']
    except Exception:
        status = False
        statusCode = 400
        description = "Faltan datos obligatorios"
    else:
        if not _owns_template(event, templateName):
            return {
                'status': False,
                'statusCode': 403,
                'description': 'La plantilla no pertenece a tu cuenta.',
                'template': None,
            }
        # Recuperar la plantilla de correo electrónico
        try:
            responseTemplate = ses_client.get_template(TemplateName=templateName)
            print("plantilla recuperada correctamente")

            templateAuditId = str(uuid.uuid4())
            now = datetime.utcnow()
            formattedDate = now.strftime("%Y-%m-%d %H:%M:%S")

            table_templateAudit.put_item(
                Item={
                    'templateAuditId': templateAuditId,
                    'userId': userId,
                    'templateName': templateName,
                    'action': 'Get',
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
        'template': responseTemplate['Template'] if responseTemplate else None,
    }
