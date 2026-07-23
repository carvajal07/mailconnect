import re
import boto3
import uuid
from datetime import datetime

REGION = 'us-east-1'


def _ses_safe(s):
    """SES exige que TemplateName solo tenga [A-Za-z0-9_-]. Reemplaza cualquier
    otro caracter (espacios, acentos, signos) por '-' (guion medio) para que
    create_template no falle (p. ej. un nombre con espacios). Los segmentos del
    nombre siguen unidos por '_'. Idempotente sobre nombres ya válidos."""
    return re.sub(r'[^A-Za-z0-9_-]+', '-', str(s)).strip('-') or 'plantilla'

# Inicializar el cliente SES
ses_client = boto3.client('ses', region_name=REGION)
# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')

table_channel = dynamodb.Table('channel')
table_customer = dynamodb.Table('customer')
tabla_consecutive = dynamodb.Table('templateControl')
table_templateAudit = dynamodb.Table('templateAudit')
_audit_table = dynamodb.Table('adminAudit')


def _audit_event(event, action, target, detail):
    """Bitácora global (adminAudit) best-effort. El actor sale del context del Authorizer."""
    try:
        auth = (event.get('requestContext') or {}).get('authorizer') or {} if isinstance(event, dict) else {}
        _audit_table.put_item(Item={
            'auditId': str(uuid.uuid4()),
            'action': action,
            'actor': str(auth.get('user') or auth.get('userId') or 'cliente'),
            'actorId': str(auth.get('userId') or ''),
            'customer': str(auth.get('customer') or ''),
            'target': str(target),
            'detail': str(detail),
            'date': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'),
        })
    except Exception as e:
        print('No se pudo registrar auditoría: {}'.format(e))


def _find_control(customerId, projection):
    """Primer ítem de templateControl del cliente. Pagina el Scan (LastEvaluatedKey)
    para no perder el ítem si la tabla supera 1 MB (antes, sin paginar, devolvía
    vacío → el consecutivo se reiniciaba a 0001 e insertaba un duplicado)."""
    kwargs = {
        'FilterExpression': 'customerId = :value',
        'ExpressionAttributeValues': {':value': customerId},
        'ProjectionExpression': projection,
    }
    while True:
        resp = tabla_consecutive.scan(**kwargs)
        if resp.get('Items'):
            return resp['Items'][0]
        last = resp.get('LastEvaluatedKey')
        if not last:
            return None
        kwargs['ExclusiveStartKey'] = last


def consult_consecutive(customerId):
    # NOTA: sigue habiendo carrera si dos creaciones concurren (mismo consecutivo);
    # el fix atómico (ADD sobre PK=customerId) requiere migrar la tabla (Fase 3).
    consecutive = "0000"
    item = _find_control(customerId, 'numeration')
    if item:
        consecutive = item['numeration']

    consecutiveInt = int(consecutive)
    consecutiveInt += 1
    consecutiveString = str(consecutiveInt)
    consecutive = consecutiveString.zfill(4)
    return consecutive

def update_consecutive(customerId,consecutive):
    item = _find_control(customerId, 'templateControlId')
    if not item:
        # No existe el control del cliente: crear (primer consecutivo o tabla vacía).
        tabla_consecutive.put_item(
            Item={
                'templateControlId': str(uuid.uuid4()),
                'customerId': customerId,
                'numeration': consecutive
            }
        )
    else:
        templateControlId = item['templateControlId']
        responseUpdateConsecutive = tabla_consecutive.update_item(
            Key={'templateControlId':templateControlId},
            UpdateExpression='SET numeration = :s',
            ExpressionAttributeValues={':s': consecutive},
            ReturnValues='UPDATED_NEW'
        )
        print(responseUpdateConsecutive['Attributes'])

def select_customerName(customerId):
    # customerId es la PK de `customer` → GetItem O(1) (antes Scan+filter).
    item = table_customer.get_item(
        Key={'customerId': customerId}, ProjectionExpression='company').get('Item') or {}
    return item.get('company', '')

def select_channelName(channelId):
    projectionName_expression = 'channelName'  # Lista de campos a consultar

    response = table_channel.scan(
        FilterExpression="channelId = :value",
        ExpressionAttributeValues={":value": int(channelId)},
        ProjectionExpression=projectionName_expression
    )
    return response['Items'][0]['channelName']

def create_template(templateName,subject,htmlBody,textBody):    
    print("template:" + templateName)
    response = ses_client.create_template(
        Template={
            'TemplateName': templateName,
            'SubjectPart': subject,
            'HtmlPart': htmlBody,
            "TextPart": textBody
        }
    )
    print("plantilla creada correctamente")    

def insert_audit(userId,templateName,action):
    templateAuditId = str(uuid.uuid4())
    # Obtener la fecha y hora actual
    now = datetime.utcnow()
    # Formatear la fecha y hora según un formato específico
    formattedDate = now.strftime("%Y-%m-%d %H:%M:%S")
    
    # Insertar datos en la tabla de datos de usuarios
    table_templateAudit.put_item(
        Item={
            'templateAuditId': templateAuditId,
            'userId': userId,
            'templateName': templateName,
            'action': action,
            'date': formattedDate
        }
    )

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
    description = "Plantilla creada correctamente"
    statusCode = 201

    try:
        # Obtener datos del evento
        userId = event['userId'] 
        customerId = event['customerId']
        channel = event['channel']
        templateName = event['templateName']
        subject = event['subject']
        htmlBody = event['htmlBody']
        textBody = event['textBody']
    except Exception as e:
        print(e)
        status = False
        statusCode = 500
        description = "Error no controlado en el servicio"
    else:
        # Crear la plantilla de correo electrónico
        try:
            #Consultar el nombre de customer para el id enviado
            try:
                customerName = select_customerName(customerId)
            except Exception as e:
                status = False
                statusCode = 404
                description = "Error consultando el nombre de cliente en la tabla customers"
                print(e)

            #Consultar el consecutivo de la comunicacion para el cliente especificado
            if status:
                try:
                    consecutive = consult_consecutive(customerId)
                except Exception as e:
                    status = False
                    statusCode = 404
                    description = "Error consultando el consecutivo en la tabla campaignControl"
                    print(e)

            #Actualizar la informacion del consecutivo de campañas
            if status:
                try:
                    update_consecutive(customerId,consecutive)
                except Exception as e:
                    status = False
                    statusCode = 404
                    description = "Error actualizando el consecutivo en la tabla campaignControl"
                    print(e)

            # Crear el template en SES SOLO si los pasos previos fueron OK. Antes los
            # try/except NO cortaban el flujo: un fallo temprano seteaba el error pero igual
            # se llamaba a create_template → la plantilla quedaba creada en SES aunque la
            # respuesta fuera error. Además se quitó el lookup de canal (select_channelName),
            # cuyo resultado NUNCA se usaba y solo podía provocar un 404 falso.
            if status:
                try:
                    # El nombre de la plantilla SES NO lleva el canal: una misma plantilla HTML
                    # puede usarse en varios canales de email (EM/EAU/EAP). Convención:
                    # {customer}_{consecutivo}_{nombre} (coincide con el lookup de Prepare-batch).
                    # Se sanean el cliente y el nombre del usuario porque SES rechaza
                    # espacios/acentos/signos en TemplateName (antes → 500 al crear).
                    templateName = '{}_{}_{}'.format(_ses_safe(customerName), consecutive, _ses_safe(templateName))
                    response = create_template(templateName,subject,htmlBody,textBody)
                except Exception as e:
                    status = False
                    statusCode = 500
                    description = "Error realizando la creacion del template en SES"
                    print(e)

            #Realizar el insert de la trazabilidad de los template
            if status:
                try:
                    insert_audit(userId,templateName,'Create')
                except Exception as e:
                    status = False
                    statusCode = 500
                    description = "Error realizando el insert de la trazabilidad"
                    print(e)

            # Bitácora global (adminAudit) — visible en el tab de Auditoría del admin.
            if status:
                _audit_event(event, 'template.create', templateName,
                             "Plantilla de correo (HTML) '{}' creada".format(templateName))

        except Exception as e:
            print(e)
            status = False
            statusCode = 500
            description = "Error no controlado en el servicio"
    finally:
        # Respuesta
        response = {
            'status':status,
            'statusCode': statusCode,
            'description':description
        }

    return response