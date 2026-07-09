import json
import os
import boto3
import botocore
from botocore.exceptions import ClientError
from botocore.client import Config
from datetime import datetime

def lambda_handler(event, context):
    status = True
    description = "Url creada correctamente"
    statusCode = 200
    
    # Obtiene las claves de acceso del entorno
    access_key = os.environ['accessKey']
    secret_key = os.environ['secretKey']

    # Extraer datos del evento
    customer = event['customer']
    campaignId = event['campaignId']
    documentType = event['documentType']
    documentName = event['documentName']

    # Validar que se proporcionaron los datos necesarios
    if not customer or not campaignId or not documentType:
        return {
            'statusCode': 400,
            'body': json.dumps('Faltan datos requeridos: cliente, campaña, tipoDato')
        }

    # Configurar el cliente de S3
    s3_client = boto3.client('s3',aws_access_key_id=access_key,aws_secret_access_key=secret_key,config=Config(signature_version='s3v4'))

    # Configurar la información del bucket de S3 y la clave del objeto
    bucketName = f'mailconnect.{documentType}'
    
    # Obtener la fecha y hora actual
    now = datetime.utcnow()
    # Formatear la fecha y hora según un formato específico
    formattedDate = now.strftime("%Y-%m-%d")
    path = f'{customer}/{formattedDate}/{documentName}'

    # Generar la URL prefirmada
    try:
        if documentName == 'document':
            

        url = s3_client.generate_presigned_url(
            ClientMethod='put_object',
            Params={'Bucket': bucketName, 'Key': path},
            ExpiresIn=3600
        )
    except ClientError as e:
        print(f"Error al generar la URL prefirmada: {e}")
        status = False
        statusCode = 500
        description = f"Error al generar la URL prefirmada: {e}"

    finally:
        
        # Validar la firma
        try:
            botocore.sign_url(url)
            print('La URL prefirmada es válida.')
        except :
            print('La firma de la URL prefirmada no es válida.')
        # Respuesta
        response = {
            'status':status,
            'statusCode': statusCode,
            'description':description,
            'data':{
                'url': url,
                'path': path
            }
        }

    return response