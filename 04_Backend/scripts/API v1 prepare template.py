from botocore.exceptions import ClientError
from datetime import datetime
import boto3
import uuid
import json
import csv
import os
import re
import io

# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')

# Inicializa el cliente de S3
s3 = boto3.client('s3')

# Configurar el cliente de SQS
sqs = boto3.client('sqs')

table_processDetail = dynamodb.Table('process')
table_document = dynamodb.Table('document')
table_campaign = dynamodb.Table('campaign')

urlSQS = 'https://sqs.us-east-1.amazonaws.com/873837768806/email_send'

message = ""
body = ""
messages = []
globalCounterMessage = 0


samples = False
invalidMail = False
invalidMails = ""
registersForEM = 10
registersForEA = 5
registersForMessage = 0

def insert_process(processId,process,campaignId,userId,registers,parts,templateVersion,date,state):    
    # Insertar datos en la tabla de campañas
    table_processDetail.put_item(
        Item={
            'processId': processId,
            'process': process,
            'campaignId': campaignId,
            'userId': userId,
            'registers': registers,
            'parts': parts,
            'templateVersion': templateVersion,
            'date': date,
            'processState': state
        }
    )

def update_campaignStatus(campaignId,state):
    responseUpdateCampaignStatus = table_campaign.update_item(
        Key={'campaignId':campaignId},
        UpdateExpression='SET campaignState = :s',
        ExpressionAttributeValues={':s': state},
        ReturnValues='UPDATED_NEW'
    )
    print(responseUpdateCampaignStatus['Attributes'])

def select_campaign(campaignName):
    projectionCampaign_expression = 'campaignId, customerId, consecutive, channel, dataPath, campaignState'  # Lista de campos a consultar

    responseCampaign = table_campaign.scan(
        FilterExpression="campaignName = :value",
        ExpressionAttributeValues={":value": campaignName},
        ProjectionExpression=projectionCampaign_expression
    )
    return responseCampaign

def prepare_message(processId,data,headers,attachment,templateName,part):
    body = {
        "processId":processId,
        "Attachment": attachment,
        "templateName":templateName,
        "headers":headers,
        "part":part,
        "data":data
    }
    message = {
        "Id":str(part),
        "MessageBody":str(body)
    }
    messages.append(message)
    print(message)
    return messages


def send_SQS(messages):
    print("Mensaje enviado")
    response = sqs.send_message_batch(
        QueueUrl=urlSQS,
        Entries=messages
    )

    #Validar la posibilidad de reintentos si no se puede encolar

def search_samples(fileIn,samples,recipients,quantitySamples,quantityRecipients):
    recordsFound = []
    samplesCount = 0
    indexRecipient = 0
    print(samples)
    with open(fileIn, 'r') as file:
        next(file) #Omito la primer linea que pertenece al encabezado
        for line in file:   
            #Reviso si ya asigne la cantidad total de muestras para no seguir recorriendo las lineas
            if samplesCount == quantitySamples: break
            id = int(line.split(";")[0])
            #print(id)

            #V1
            for sample in samples:
                print(sample)
                if id == sample:
                    samplesCount += 1
                    print("Entro")
                    #Reemplazar email real
                    if (indexRecipient == quantityRecipients):
                        indexRecipient = 0
                    #Reemplazar el email real por el email de muestras
                    newEmail = recipients[indexRecipient]
                    realEmail = line.split(";")[1]
                    line = line.replace(realEmail,newEmail)
                    recordsFound.append(line)
                    indexRecipient += 1
                    break

            #V2
            if id in samples:
                samplesCount += 1
                print("Entro")
                #Reemplazar email real
                if (indexRecipient == quantityRecipients):
                    indexRecipient = 0
                #Reemplazar el email real por el email de muestras
                newEmail = recipients[indexRecipient]
                realEmail = line.split(";")[1]
                line = line.replace(realEmail,newEmail)
                recordsFound.append(line)
                indexRecipient += 1
         
    return recordsFound

def emailReplace(records,recipients):
    pass

def check_and_create_table(tableName, id):

    key_schema = [
        {
            'AttributeName': id,
            'KeyType': 'S'
        }
    ]
    attribute_definitions = [
        {
            'AttributeName': id,
            'AttributeType': 'S'
        }
    ]
    try:
        # Intenta crear la tabla
        table = dynamodb.create_table(
            TableName=tableName,
            KeySchema=key_schema,
            AttributeDefinitions=attribute_definitions,
            BillingMode='PAY_PER_REQUEST'  # Configura capacidad bajo demanda
        )
        print(f"La tabla '{tableName}' ha sido creada con éxito.")
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceInUseException':
            print(f"La tabla '{tableName}' ya existe.")
        else:
            print("Error al crear la tabla:", e)


def lambda_handler(event, context):
    status = True
    description = "Campaña enviandose correctamente"
    statusCode = 200
    
    # Obtener la fecha y hora actual
    now = datetime.utcnow()
    # Formatear la fecha y hora según un formato específico
    formattedDate = now.strftime("%Y-%m-%d %H:%M:%S")
    
    try:
        # Obtener datos del evento
        
        endpoint = event["resource"]
        print("endpoint: " + endpoint)
        data = json.loads(event["body"])
        #print(body)
        #data = json.loads(body)
        #print(data)
        customerName = data["customerName"]
        print(customerName)
        campaignName = data["campaignName"]
        userId = data["userId"]

        #Puedo dejar estos dos datos para posiblemente mas adelante usarlos
        #Para enviar alguna prueba, muestra, reenvio de una version especifica
        template = data['template']
        templateVersion = data['templateVersion']
        ####################################

        samples = "Send-batch-template-samples" in endpoint
        print(samples)    
        responseCampaign = select_campaign(campaignName)
        if responseCampaign['Items']:
            print(f'La campaña "{campaignName}" fue encontrada en la BD')
            state = responseCampaign['Items'][0]["campaignState"]
            
            #Solo realizo envio si el estado de la campaña se encuentra en estado "Pendiente" o "Muestras"
            #Si el estado es "Enviando" o "Terminada" quiere decir que es una campaña que ya no se debe enviar
            #El estado error se debe revisar como soporte
            #if (state == "Pendiente" or state == "Muestras"):
            if (state == "Pendiente" or state == "Muestras" or state == "Error"): 
                print(f'La campaña se encuentra en estado "{state}" y se puede realizar su envio')
                processId = str(uuid.uuid4())
                # Detalles del archivo en S3
                bucketName = f'{customerName}.database'
                tempFile = f'/tmp/{customerName}_{formattedDate}.tmp'  # Ruta temporal para almacenar el archivo descargado

                campaignId = responseCampaign['Items'][0]["campaignId"]                
                #REVISAR
                #El siguiente campo parece que no lo necesito
                customerId = responseCampaign['Items'][0]["customerId"]
                consecutive = responseCampaign['Items'][0]["consecutive"]
                channelName = responseCampaign['Items'][0]["channel"]
                dataPath = responseCampaign['Items'][0]["dataPath"]
                
                # Define los detalles de la tabla processDetail
                table = f'{customerName}_processDetail'
                id = 'processDetailId'
                check_and_create_table(table,id)

                # Define los detalles de la tabla sendDetail
                table = f'{customerName}_sendDetail'
                id = 'sendDetailId'
                check_and_create_table(table,id)

                #Tabla de unsubscribe
                table = f'{customerName}_unsubscribe'
                id = 'unsubscribeId'
                check_and_create_table(table,id)

                #Realizar la creacion de la cola para el cliente
                #Configurar la cola como disparador

                templateName = f'{customerName}{consecutive}{channelName}_{campaignName}'
                attachment = channelName == "EA"
                registers = ""
                countRegister = 0
                countMessage = 0
                try:
                    # Descarga el archivo CSV desde S3
                    s3.download_file(bucketName, dataPath, tempFile)
                except:
                    update_campaignStatus(campaignId,"Error")
                    print(f'No se pudo realizar la descarga del archivo "{tempFile}" del bucket "{bucketName} - {dataPath}"')
                    status = False
                    description = f'No se pudo realizar la descarga del archivo "{tempFile}" del bucket "{bucketName} - {dataPath}"'
                    statusCode = 404
                else: 
                    registers = []
                    headers = ""
                    #En el front se debe agregar un boton o slider para elegir la cantidad de muestras
                    #Entre 1 y 5 muestras maximo
                    #Se debe poner entre 1 y 2 campos (1 campo para el email y el otro campo es para la identificacion que solo aplica si son muestras selectivas)                    

                    if (samples):
                        print("Inica proceso de envio de muestras")
                        patron_email = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z0-9]{2,}$'
                        process = campaignName + "-Samples"                    
                        quantitySamples = data['quantitySamples']   
                        selectiveSamples = data.get('selectiveSamples',False)                   
                        recipients = data["recipients"]
                        #Validar que los email sean correctos
                        quantityRecipients = len(recipients)
                        invalidMail = False
                        invalidMails = ""
                        for email in recipients:
                            if not re.match(patron_email, email):
                                invalidMail = True
                                invalidMails += email
                                
                        if invalidMail:
                            print(f'Error en las direcciones email enviadas para las muestras, emails con error: {invalidMails}')
                            status = False
                            description = f'Error en las direcciones email enviadas para las muestras, emails con error: {invalidMails}'
                            statusCode = 400
                        else:
                            print("Todos los email enviados son validos")
                            if selectiveSamples:
                                print("Proceso con muestras selectivas")
                                #En el proceso de muestras selectivas solo se van a enviar la cantidad de registros que se encuentren en el spool del cliente
                                #No se realizara el proceso de completar la cantidad de muestras
                                try:
                                    identifications = data["identifications"]

                                    samplesCount = 0
                                    indexRecipient = 0
                                    print(samples)
                                    with open(tempFile, 'r') as file:
                                        headers = next(file) #Agrego la primer linea que pertenece al encabezado a una variable
                                        for line in file:   
                                            #Reviso si ya asigne la cantidad total de muestras para no seguir recorriendo las lineas
                                            if samplesCount == quantitySamples: break
                                            id = int(line.split(";")[0])
                                            #print(id)
                                            for sample in samples:
                                                print(sample)
                                                if id == sample:
                                                    samplesCount += 1
                                                    print("Entro")
                                                    #Reemplazar email real
                                                    if (indexRecipient == quantityRecipients):
                                                        indexRecipient = 0
                                                    #Reemplazar el email real por el email de muestras
                                                    newEmail = recipients[indexRecipient]
                                                    realEmail = line.split(";")[1]
                                                    line = line.replace(realEmail,newEmail)
                                                    registers.append(line)
                                                    indexRecipient += 1
                                                    break
                                  

                                    #registers = search_samples(tempFile,identifications,recipients,quantitySamples,quantityRecipients)
                                    print(registers)
                                    #registers = emailReplace(registers,recipients)
                                except Exception as e:
                                    print(e)
                                    update_campaignStatus(campaignId,"Error")
                                    print('Error en el filtrado de los registros desde la base de datos original')
                                    status = False
                                    description = 'Error en el filtrado de los registros desde la base de datos original'
                                    statusCode = 400
                                else:
                                    print('Los filtros de registros se realizaron de manera correcta')
                                    samplesFound = len(registers)
                                    if samplesFound > 0:
                                        print("Se procede a realizar los envios a la cola")
                                        messages = prepare_message(processId,registers,headers,attachment,templateName,1)
                                        send_SQS(messages)
                                    else:
                                        print(f'No se encontro ningura de las cedulas "{identifications}" en el spool de envios')
                                
                            else:
                                print("Proceso con muestras automaticas")
                                try:
                                    #Se realiza el envio de la cantidad de email indicados con la data de los primeros registros de la BD
                                    indexRecipient = 0
                                    print('Inicio lectura del archivo para tomar los primeros registros y reemplazar el email real con el de muestras')
                                    with open(tempFile, 'r') as file:
                                        headers = next(file).strip() #Agrego la primer linea que pertenece al encabezado a una variable
                                        for line in file:                                    
                                            #Reinicio el indice de los recipient para cuando la cantidad de muestras es mayor a los email enviados en la lista
                                            if (indexRecipient == quantityRecipients):
                                                indexRecipient = 0
                                            #Reemplazar el email real por el email de muestras
                                            newEmail = recipients[indexRecipient]    
                                            realEmail = line.split(";")[1]
                                            line = line.replace(realEmail,newEmail)
                                            registers.append(line)
                                            countRegister += 1
                                            indexRecipient += 1
                                            if countRegister == quantitySamples:
                                                messages = prepare_message(processId,registers,headers,attachment,templateName,1)
                                                send_SQS(messages)
                                                registers = []
                                                break
                                    #Valido si hay registros, es decir que la BD original no contenia los suficientes registros para las muestras
                                    if registers:
                                        print("La cantidad de muestras solicitada es mayor a la data que se encuentra en la BD")
                                        messages = prepare_message(processId,registers,headers,attachment,templateName,1)
                                        send_SQS(messages)
                                    # Elimina el archivo temporal descargado
                                    os.remove(tempFile)
                                except:
                                    update_campaignStatus(campaignId,"Error")
                                    print('Error en el proceso de muestras automaticas')
                                    status = False
                                    description = 'Error en el proceso de muestras automaticas'
                                    statusCode = 400
                            insert_process(processId,process,campaignId,userId,quantitySamples,1,templateVersion,formattedDate,"Muestras")
                            update_campaignStatus(campaignId,"Muestras")
                            
                    else:
                        print("Inicia proceso de envio real")
                        update_campaignStatus(campaignId,"Enviando")
                        # Lee el archivo CSV descargado y agrupa los datos  
                        if (channelName == "EM"): registersForMessage = registersForEM          
                        if (channelName == "EA"): registersForMessage = registersForEA
                        globalCountRegisters = 0
                        globalCounterMessage = 0                        
                        try:
                            with open(tempFile, 'r') as file:
                                headers = next(file) #Agrego la primer linea que pertenece al encabezado a una variable
                                for line in file:
                                    #line2 = line.strip
                                    registers.append(line.strip())
                                    countRegister += 1
                                    globalCountRegisters +=1
                                    if countRegister == registersForMessage:
                                        print("Primer mensaje")
                                        countMessage += 1
                                        globalCounterMessage += 1
                                        countRegister = 0
                                        messages = prepare_message(processId,registers,headers,attachment,templateName,globalCounterMessage)
                                        registers = []
                                        if countMessage == 10:
                                            countMessage = 0
                                            #Enviar a SQS
                                            send_SQS(messages)

                                            #borrar messages
                                            messages = []
                            #Si aun existen registros (porque no se completo el lote de 100) se envian en un mensaje a SQS
                            if registers:
                                globalCounterMessage += 1
                                messages = prepare_message(processId,registers,headers,attachment,templateName,globalCounterMessage)
                                #Enviar a SQS
                                send_SQS(messages)
                        except Exception as e:
                            update_campaignStatus(campaignId,"Error")
                            print(e)
                            print('Error en el proceso de envios reales')
                            status = False
                            description = 'Error en el proceso de envios reales'
                            statusCode = 400
                        else:
                            print("TotalMensajes: " + str(globalCounterMessage)) 
                            #El total de mensajes es el total de partes para insertar en processDetail    
                            insert_process(processId,campaignName,campaignId,userId,globalCountRegisters,globalCounterMessage,templateVersion,formattedDate,"Procesando")
                            # Elimina el archivo temporal descargado
                            os.remove(tempFile)

            #Si el estado es "Enviando" o "Terminada" quiere decir que es una campaña que ya no se debe enviar
            else:
                print(f'La campaña se encuentra en estado "{state}" y por esta razon no puede ser enviada')
                status = False
                description = f'La campaña se encuentra en estado "{state}" y por esta razon no puede ser enviada'
                statusCode = 404
        else:
            update_campaignStatus(campaignId,"Error")
            print(f'La campaña "{campaignName}" no se encuentra registrada en la Base de datos')
            status = False
            description = f'La campaña "{campaignName}" no se encuentra registrada en la Base de datos'
            statusCode = 404
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