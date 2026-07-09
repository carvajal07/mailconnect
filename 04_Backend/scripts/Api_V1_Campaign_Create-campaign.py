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

def consult_consecutive(customerId):
    #Inicio de consulta del consecutivo para la campaña
    #consulta por scan
    consecutive = "0000"       
    projectionConsecutive_expression = 'numeration'  # Lista de campos a consultar

    responseConsecutive = tabla_consecutive.scan(
        FilterExpression="customerId = :value",
        ExpressionAttributeValues={":value": customerId},
        ProjectionExpression=projectionConsecutive_expression
    )
    if responseConsecutive['Items']:
        consecutive = responseConsecutive['Items'][0]['numeration']

    consecutiveInt = int(consecutive)
    consecutiveInt += 1
    consecutiveString = str(consecutiveInt)
    consecutive = consecutiveString.zfill(4)
    return consecutive

def update_consecutive(customerId,consecutive):
    if (consecutive == "0001"):
        # Debo realizar el insert a la tabla 
        campaignControlId = str(uuid.uuid4())
        # Insertar datos en la tabla de consecutivos
        tabla_consecutive.put_item(
            Item={
                'campaignControlId': campaignControlId,
                'customerId': customerId,
                'numeration': consecutive
            }
        )
    else:           
        projectionConsecutive_expression = 'campaignControlId'  # Lista de campos a consultar
        responseId = tabla_consecutive.scan(
            FilterExpression='customerId = :c',
            ExpressionAttributeValues={':c': customerId},
            ProjectionExpression=projectionConsecutive_expression
        )
        if responseId['Items']:
            campaignControlId = responseId['Items'][0]['campaignControlId']

        responseUpdateConsecutive = tabla_consecutive.update_item(
            Key={'campaignControlId':campaignControlId},
            UpdateExpression='SET numeration = :s',
            ExpressionAttributeValues={':s': consecutive},
            ReturnValues='UPDATED_NEW'
        )
        print(responseUpdateConsecutive['Attributes'])

def insert_campaign(customerId,campaignName,numeration,channel,dataPath,template,source,date):    
    campaignId = str(uuid.uuid4())
    # Insertar datos en la tabla de campañas
    table_campaign.put_item(
        Item={
            'campaignId': campaignId,
            'customerId': customerId,
            'campaignName': campaignName,
            'consecutive': numeration,
            'channel': channel,
            'dataPath': dataPath,
            'template': template,
            'from': source,
            'state': 'Pendiente',
            'date': date
        }
    )
    return campaignId

def create_template(customerId,channelName,consecutive,campaignName,subject,template):    
    customerName = select_customerName(customerId)    
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

def insert_attachment(campaignId,documentPath,variableDocument,date):
    documentId = str(uuid.uuid4())
    # Insertar datos en la tabla de documentos
    table_document.put_item(
        Item={
            'documentId': documentId,
            'campaignId': campaignId,
            'documentPath': documentPath,
            'variableDocument': variableDocument,
            'date': date
        }
    )

def lambda_handler(event, context):
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
        # Obtener datos del evento
        customerId = event['customerId']
        campaignName = event['campaignName']
        channel = event['channel']        
        dataPath = event['dataPath']   
        template = event['template']
        source = event['from']

        #Si el campo de from llega con @ quiere decir que este ya tiene su dominio, en caso contrario agregamos "mailconnect.com.co"
        if (not "@" in source):
            source += "mailconnect.com.co"
            
            
        print("Inicio validación de los datos del payload")
        # Validación del campo channel
        if not bool(re.match('^[0-9]+$', channel)):
            validData = False
            print("El campo proporcionado para el canal no es correcto, ya que este no contiene solo numeros o esta vacio")        

        #Opcionales
        variableDocument = event.get('variableDocument',False)
        #subject = event.get('subject','SMS')
        mask = event.get('mask','')
        attachment = event.get('attachment','')

        #Validar si la mascara contiene informacion para agregarla al from
        if (not "" in mask):
            source = f"<{mask}>{source}>"

        #channel
        #1 - EA-Email con adjunto
        #2 - EM-Email marketing
        #3 - SMS-Mensajes de texto
        '''
        if (channel == "1" or channel == "2"):
            if (subject == "" or mask == ""): validData = False
        '''
            
        if (channel == "1"):
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
                try:
                    channelName = select_channelName(channel)
                except:
                    status = False
                    statusCode = 404
                    description = "Error consultando el nombre de canal en la tabla channel"
                    break

                #Realizar la creacion del template en AWS SES
                #Esta parte no deberia ir, el template se crea antes de crear la campaña
                '''
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
                    campaignName = consecutive + "_" + campaignName
                    campaignId = insert_campaign(customerId,campaignName,consecutive,channelName,dataPath,template,source,formattedDate)
                except:
                    status = False
                    statusCode = 404
                    description = "Error insertando la campaña en la tabla campaign"
                    break                

                #Insertar informacion de los adjuntos para el caso de EA-Email con adjunto
                try:
                    if (channel == "1"):
                        print("Canal 1")
                        for attach in attachment:
                            print("for")
                            path = attach.get('path')
                            insert_attachment(campaignId,path,variableDocument,formattedDate)
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