import csv
import os
import boto3
import uuid
import boto3
from datetime import datetime, timedelta
from boto3.dynamodb.conditions import Key

# Inicializa el cliente de S3
s3 = boto3.client('s3')
# Configurar el cliente de SQS
sqs = boto3.client('sqs')
# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')
# Crear un cliente de DynamoDB
table_campaign = dynamodb.Table('campaign')
table_customer = dynamodb.Table("customer")

quantityRegistersByMassage = 100
quantityMessagesByBulk = 10

# Detalles del archivo en S3
bucketName = 'mailconnect.database'
queueUrl = 'https://sqs.us-east-1.amazonaws.com/873837768806/email_send'
idTempFile = uuid.uuid4().hex[:8]
tempFile = f'/tmp/{idTempFile}/temp_file.csv'  # Ruta temporal para almacenar el archivo descargado

def select_customerName(customerId):
    projectionCustomer_expression = 'company'  # Lista de campos a consultar

    response = table_customer.scan(
        FilterExpression="customerId = :value",
        ExpressionAttributeValues={":value": customerId},
        ProjectionExpression=projectionCustomer_expression
    )
    return response['Items'][0]['company']

def update_campaignStatus(campaignId,status):        
    responseUpdateCampaign = table_campaign.update_item(
        Key={'campaignId':campaignId},
        UpdateExpression='SET status = :s',
        ExpressionAttributeValues={':s': status},
        ReturnValues='UPDATED_NEW'
    )
    print(responseUpdateCampaign['Attributes'])

def update_campaignRegisters(campaignId,attributes): 
    key = {'campaignId': campaignId}      
    # Actualiza el elemento
    table_campaign.update_item(
        Key=key,
        AttributeUpdates=attributes
    )


def send_messageSQS(message):
    response = sqs.send_message_batch(
        QueueUrl=queueUrl,
        Entries=message
    )

def lambda_handler(event, context):
    status = True
    description = "Campaña enviandose correctamente"
    statusCode = 200

    try:
        # Obtener datos del evento
        userId = event['userId']
        campaignId = event['campaignId']

        # Consultar los datos de la campaña
        projectionCampaign_expression = 'customerId, campaignName, consecutive, channel, dataPath, mask, from, state'  # Lista de campos a consultar

        responseCampaign = table_campaign.get_item(
            FilterExpression="campaignId = :value",
            ExpressionAttributeValues={":value": campaignId},
            ProjectionExpression=projectionCampaign_expression
        )

        # Verificar si se encontró el elemento
        if responseCampaign['Items']:
            state = responseCampaign['Items'][0]['state']
        
        if (state == "Pendiente"):
            update_campaignStatus(campaignId,"Enviando")
            customerId = responseCampaign['Items'][0]['customerId']
            campaignName = responseCampaign['Items'][0]['campaignName']
            consecutive = responseCampaign['Items'][0]['consecutive']
            channelName = responseCampaign['Items'][0]['channel']
            fileName = responseCampaign['Items'][0]['dataPath']
            mask = responseCampaign['Items'][0]['mask']
            fromEmail = responseCampaign['Items'][0]['from']
            if (mask != ""):
                friendlyFrom = mask + " <" + fromEmail + ">"
            else:
                friendlyFrom = fromEmail

            # Consultar nombre del cliente
            customerName = select_customerName(customerId)  
            #despues de consultar los datos de la campaña debo ir a buscar el csv a S3
            templateName = f'{customerName}_{consecutive}_{channelName}_{campaignName}'
            # Descarga el archivo CSV desde S3
            s3.download_file(bucketName, fileName, tempFile)

            # Lee el archivo CSV descargado y agrupa los datos
            message = ""
            body = ""
            messages = []
            registers = ""
            processDetailId = str(uuid.uuid4())
            globalCounterMessage = 0
            globalCounterRegisters = 0
            countRegister = 0
            countMessage = 0
            with open(tempFile, 'r') as file:
                lines = file.readlines()
                next(file) 
                for line in file:
                    registers += line
                    countRegister += 1
                    if countRegister == quantityRegistersByMassage:
                        countMessage += 1
                        globalCounterMessage += 1
                        globalCounterRegisters += countRegister
                        countRegister = 0
                        body = {
                            "processDetailId":processDetailId,
                            "templateName":templateName,
                            "source":friendlyFrom,
                            "data":registers
                        }
                        message = {
                            "Id":str(countMessage),
                            "MessageBody":str(body)
                        }
                        messages.append(message)
                        registers = ""
                        if countMessage == quantityMessagesByBulk:
                            countMessage = 0
                            #Enviar a SQS
                            send_messageSQS(messages)

                            #borrar messages
                            messages = []
            if registers:
                globalCounterMessage += 1
                globalCounterRegisters += countRegister
                body = {
                    "processDetailId":"dfs345fgd",
                    "templateName":"nombreTemplate",
                    "source":"sender@example.com",
                    "data":registers
                }
                message = {
                    "Id":str(countMessage),
                    "MessageBody":str(body)
                }
                messages.append(message)
                #Enviar a SQS
                send_messageSQS(messages)

            attibutes = {'registers':globalCounterRegisters,'parts':globalCounterMessage}
            update_campaignRegisters(campaignId,attibutes)
            print("TotalMensajes: " + str(globalCounterMessage))   
            # Elimina el archivo temporal descargado
            os.remove(tempFile)  
        else:
            status = False
            description = "La campaña indicada ya se encuentra enviada o en proceso de envio"
            statusCode = 204
            print("La campaña indicada ya se encuentra enviada o en proceso de envio")
        