'''
Lambda para realizar el prefirmado de url para la posterior carga de archivos a S3
'''
import json
from datetime import datetime

import boto3
import botocore
from botocore.exceptions import ClientError
from botocore.client import Config

#pylint: disable=C0301
REGION = 'us-east-1'

def lambda_handler(event, context):
    """
    Función principal

    Args:
        event (dict): Datos de evento
        context (dict): Datos de contexto
        
    Returns:
        None: Personalizado
    """
    status = True
    description = "Url creada correctamente"
    status_code = 200

    # Obtiene las claves de acceso del entorno
    #access_key = os.environ['accessKey']
    #secret_key = os.environ['secretKey']

    # Extraer datos del evento
    customer = event['customer']
    document_name = event['documentName']
    document_type = event['documentType']

    # Validar que se proporcionaron los datos necesarios
    if not customer or not document_type:
        return {
            'statusCode': 400,
            'body': json.dumps('Faltan datos requeridos: cliente, campaña, tipoDato')
        }

    # Configurar el cliente de S3
    #s3_client = boto3.client('s3',aws_access_key_id=access_key,aws_secret_access_key=secret_key,config=Config(signature_version='s3v4'))
    s3_client = boto3.client('s3',config=Config(signature_version='s3v4'))

    # Configurar la información del bucket de S3 y la clave del objeto
    bucket_name = f'{customer.lower()}.{document_type}'

    # Obtener la fecha y hora actual
    now = datetime.utcnow()
    # Formatear la fecha y hora según un formato específico
    formatted_date = now.strftime("%Y-%m-%d")
    path = f'{formatted_date}/{document_name}'

    # Generar la URL prefirmada
    try:
        url = s3_client.generate_presigned_url(
            ClientMethod='put_object',
            Params={'Bucket': bucket_name, 'Key': path},
            ExpiresIn=3600
        )
        print(f"URL prefirmada generada: {url}")
    except ClientError as e:
        print(f"Error al generar la URL prefirmada: {e}")
        status = False
        status_code = 500
        description = f"Error al generar la URL prefirmada: {e}"

    finally:
        # Respuesta
        response = {
            'status':status,
            'statusCode': status_code,
            'description':description,
            'data':{
                'url': url,
                'path': path
            }
        }

    return response
