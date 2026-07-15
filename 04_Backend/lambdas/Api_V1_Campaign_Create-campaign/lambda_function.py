import os
import re
import uuid
import boto3
from datetime import datetime, timedelta
from boto3.dynamodb.conditions import Key


# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')

# Inicializar el cliente SES
ses_client = boto3.client('ses', region_name='us-east-2')

table_customer = dynamodb.Table('customer')
tabla_consecutive = dynamodb.Table('campaignControl')
table_campaign = dynamodb.Table('campaign')
table_channel = dynamodb.Table('channel')
table_document = dynamodb.Table('document')
    
def select_customerName(customerId):
    projectionCustomer_expression = 'company'  # Lista de campos a consultar

    response = table_customer.scan(
        FilterExpression="customerId = :value",
        ExpressionAttributeValues={":value": customerId},
        ProjectionExpression=projectionCustomer_expression
    )
    return response['Items'][0]['company']
    
def select_channelName(channelId):
    projectionName_expression = 'channelName'  # Lista de campos a consultar

    response = table_channel.scan(
        FilterExpression="channelId = :value",
        ExpressionAttributeValues={":value": int(channelId)},
        ProjectionExpression=projectionName_expression
    )
    return response['Items'][0]['channelName']

def _find_control(customerId, projection):
    """Primer ítem de campaignControl del cliente. Pagina el Scan (LastEvaluatedKey)
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
    item = _find_control(customerId, 'campaignControlId')
    if not item:
        # No existe el control del cliente: crear (primer consecutivo o tabla vacía).
        tabla_consecutive.put_item(
            Item={
                'campaignControlId': str(uuid.uuid4()),
                'customerId': customerId,
                'numeration': consecutive
            }
        )
    else:
        campaignControlId = item['campaignControlId']
        responseUpdateConsecutive = tabla_consecutive.update_item(
            Key={'campaignControlId':campaignControlId},
            UpdateExpression='SET numeration = :s',
            ExpressionAttributeValues={':s': consecutive},
            ReturnValues='UPDATED_NEW'
        )
        print(responseUpdateConsecutive['Attributes'])

def insert_campaign(customerId,campaignName,numeration,channel,dataPath,template,source,date,documentFormat=None):
    campaignId = str(uuid.uuid4())
    item = {
        'campaignId': campaignId,
        'customerId': customerId,
        'campaignName': campaignName,
        'consecutive': numeration,
        'channel': channel,
        'dataPath': dataPath,
        'template': template,
        'originEmail': source,
        'campaignState': 'Pendiente',
        # Contador de envíos de muestras (máx. MAX_SAMPLE_SENDS en Prepare-batch).
        'samplesSentCount': 0,
        'date': date
    }
    # Solo EAP: formato del documento (DOCX = combinación Word, PDF = campos personalizados).
    # Se guarda en la campaña para que Prepare-batch pueda enrutar al armador correcto.
    if documentFormat:
        item['documentFormat'] = documentFormat
    # Insertar datos en la tabla de campañas
    table_campaign.put_item(Item=item)
    return campaignId

def create_template(customerName,channelName,consecutive,campaignName,subject,template):    
    templateName = f'{customerName}_{consecutive}_{channelName}_{campaignName}'
    print("template:" + templateName)
    response = ses_client.create_template(
        Template={
            'TemplateName': templateName,
            'SubjectPart': subject,
            'HtmlPart': template,
            "TextPart": template
        }
    )

    print("plantilla creada correctamente")    

def insert_attachment(campaignId,attachment_type,documentPath,variableDocument,date,documentFormat=None):
    documentId = str(uuid.uuid4())
    item = {
        'documentId': documentId,
        'campaignId': campaignId,
        # Antes guardaba el literal "attachment_type" (bug): la lambda de envío EAU
        # leía siempre un valor incorrecto y el ONFILE/ONLINE no funcionaba.
        'attachmentType': attachment_type,
        'documentPath': documentPath,
        'variableDocument': variableDocument,
        'date': date
    }
    # Formato del documento EAP (DOCX/PDF): lo usa el armador del adjunto personalizado.
    if documentFormat:
        item['documentFormat'] = documentFormat
    # Insertar datos en la tabla de documentos
    table_document.put_item(Item=item)

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
    description = "Campaña creada correctamente"
    statusCode = 201
    validData = True
    campaignId = ""
    
    # Obtener la fecha y hora actual
    now = datetime.utcnow()
    # Formatear la fecha y hora según un formato específico
    formattedDate = now.strftime("%Y-%m-%d %H:%M:%S")
    
    try:
        # customerId: preferir SIEMPRE la identidad del Authorizer sobre el body,
        # para que un cliente no cree campañas a nombre de otro tenant. Sin
        # contexto: si no llega, se deniega.
        _auth = (event.get('requestContext') or {}).get('authorizer') or {} if isinstance(event, dict) else {}
        customerId = _auth.get('customerId')
        if not customerId:
            return {'status': False, 'statusCode': 403,
                    'description': 'Sesión sin identidad de cliente.'}
        campaignName = event['campaignName']
        channelName = event['channelName']
        attachment_type = event['attachmentType']  
        dataPath = event['dataPath']   
        template = event['template']
        source = event['from']

        #Si el campo de from llega con @ quiere decir que este ya tiene su dominio, en caso contrario agregamos "mailconnect.com.co"
        if (not "@" in source):
            source += "@mailconnect.com.co"
            
            

        #Opcionales
        variableDocument = event.get('variableDocument',False)
        #subject = event.get('subject','SMS')
        mask = event.get('mask','')
        attachment = event.get('attachment','')
        # Solo EAP: DOCX (combinación Word) o PDF (campos personalizados). Distinto flujo,
        # costo y lambda que arma el archivo. Se normaliza a mayúsculas.
        documentFormat = str(event.get('documentFormat', '') or '').upper() or None

        #Validar si la mascara contiene informacion para agregarla al from
        # (display-name RFC 5322: 'Nombre <correo@dominio>'). Antes la condición
        # '(not "" in mask)' era siempre falsa y la máscara nunca se aplicaba.
        if mask:
            source = f"{mask} <{source}>"

        #channel
        #1 - EAU-Email con adjunto unico
        #2 - EM-Email marketing
        #3 - SMS-Mensajes de texto
        #4 - EAP-Email con adjunto personalizad
        '''
        if (channel == "1" or channel == "2"):
            if (subject == "" or mask == ""): validData = False
        '''
            
        if (channelName == "EAU" or channelName == "EAP"):
            if (attachment == ""): validData = False

    except:
        status = False
        statusCode = 500
        description = "Error no controlado en el servicio"
    else:
        if validData:            
            while(status):
                #Consultar el consecutivo de la comunicacion para el cliente especificado
                try:
                    consecutive = consult_consecutive(customerId)
                except:
                    status = False                    
                    statusCode = 404
                    description = "Error consultando el consecutivo en la tabla campaignControl"
                    break

                #Consultar el nombre de canal para el id enviado
                '''
                try:
                    channelName = select_channelName(channel)
                except:
                    status = False
                    statusCode = 404
                    description = "Error consultando el nombre de canal en la tabla channel"
                    break

                #Realizar la creacion del template en AWS SES
                #Esta parte no deberia ir, el template se crea antes de crear la campaña
                
                try:   
                    create_template(customerId,channelName,consecutive,campaignName,subject,template)
                except:
                    status = False
                    statusCode = 500
                    description = "Error realizando la creacion del template en SES"
                    break
                '''

                #Actualizar la informacion del consecutivo de campañas
                try:
                    update_consecutive(customerId,consecutive)
                except:
                    status = False
                    statusCode = 404
                    description = "Error actualizando el consecutivo en la tabla campaignControl"
                    break

                #Insertar la informacion de la campaña
                try:
                    #Voy a omitir el campo del consecutivo en el nombre de la campaña debido a que este consecutivo ya se guarda en un campo de la BD
                    #campaignName = consecutive + "_" + campaignName
                    campaignId = insert_campaign(customerId,campaignName,consecutive,channelName,dataPath,template,source,formattedDate,documentFormat)
                except:
                    status = False
                    statusCode = 404
                    description = "Error insertando la campaña en la tabla campaign"
                    break                

                #Insertar informacion de los adjuntos para el caso de EA-Email con adjunto
                try:
                    if (channelName == "EAU" or channelName == "EAP"):
                        print("Canal EAU o EAP (Email con adjunto personaliado o )")
                        for attach in attachment:
                            print("for")
                            path = attach.get('path')
                            insert_attachment(campaignId,attachment_type,path,variableDocument,formattedDate,documentFormat)
                except:
                    status = False
                    statusCode = 404
                    description = "Error al realizar el insert de los documentos adjuntos a la tabla document"
                    break
                break
        else:

            status = False
            statusCode = 400
            description = 'Error en la data enviada'

    finally:
        # Respuesta
        response = {
            'status':status,
            'statusCode': statusCode,
            'description':description,
            'data':{
                'campaignId': campaignId
            }
        }

    return response