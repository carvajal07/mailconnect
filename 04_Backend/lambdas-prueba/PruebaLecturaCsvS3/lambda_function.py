import boto3
import csv
import os

def lambda_handler(event, context):
    # Inicializa el cliente de S3
    s3 = boto3.client('s3')
    
    # Configurar el cliente de SQS
    sqs = boto3.client('sqs')

    # Detalles del archivo en S3
    bucketName = 'mailconnect.database'
    fileName = 'ArchivoPruebas_100000Registros.csv'
    tempFile = '/tmp/temp_file.csv'  # Ruta temporal para almacenar el archivo descargado

    # Descarga el archivo CSV desde S3
    s3.download_file(bucketName, fileName, tempFile)

    # Lee el archivo CSV descargado y agrupa los datos
    message = ""
    body = ""
    messages = []
    registers = ""
    globalCounterMessage = 0
    countRegister = 0
    countMessage = 0
    with open(tempFile, 'r') as file:
        next(file) 
        for line in file:
            registers += line
            countRegister += 1
            if countRegister == 100:
                countMessage += 1
                globalCounterMessage += 1
                countRegister = 0
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
                registers = ""
                if countMessage == 10:
                    countMessage = 0
                    #Enviar a SQS
                    response = sqs.send_message_batch(
                        QueueUrl='https://sqs.us-east-1.amazonaws.com/873837768806/email_send',
                        Entries=messages
                    )

                    #borrar messages
                    messages = []
    if registers:
        globalCounterMessage += 1
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
        response = sqs.send_message_batch(
            QueueUrl='https://sqs.us-east-1.amazonaws.com/873837768806/email_send',
            Entries=messages
        )

    print("TotalMensajes: " + str(globalCounterMessage))     

    # Elimina el archivo temporal descargado
    os.remove(tempFile)

    return {
        'statusCode': 200,
        'body': 'Procesamiento completado'
    }
