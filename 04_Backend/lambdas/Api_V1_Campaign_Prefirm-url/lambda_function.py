'''
Lambda para realizar el prefirmado de url para la posterior carga de archivos a S3
'''
import os
import re
import json
from datetime import datetime

import boto3
import botocore
from botocore.exceptions import ClientError
from botocore.client import Config

#pylint: disable=C0301
REGION = 'us-east-1'

# Bucket por cliente por NIT: {prefix}-{nit}-{database|document} (DNS-safe). Se usa el NIT
# en vez del nombre de empresa (evita nombres inválidos/colisiones).
BUCKET_PREFIX = os.environ.get('BUCKET_PREFIX', 'mailconnect')


def tenant_bucket(nit, doc_type):
    clean = re.sub(r'[^a-z0-9]', '', str(nit or '').lower())
    return '{}-{}-{}'.format(BUCKET_PREFIX, clean, doc_type)


def ensure_bucket(s3_client, name):
    """Crea el bucket si no existe (red de seguridad: el upload nunca falla por bucket ausente)."""
    try:
        s3_client.head_bucket(Bucket=name)
        return
    except Exception:
        pass
    try:
        s3_client.create_bucket(Bucket=name)  # us-east-1: sin LocationConstraint
        print('Bucket creado: {}'.format(name))
    except Exception as e:
        print('No se pudo asegurar el bucket {}: {}'.format(name, e))

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
    customer = event.get('customer', '')
    # NIT del cliente: define el bucket. El front lo envía; se acepta 'nit' o 'companyTin'.
    nit = event.get('nit') or event.get('companyTin')
    document_name = event['documentName']
    document_type = event['documentType']

    # Validar que se proporcionaron los datos necesarios
    if not document_type or (not nit and not customer):
        return {
            'statusCode': 400,
            'body': json.dumps('Faltan datos requeridos: nit/cliente, documentType')
        }

    # Configurar el cliente de S3
    #s3_client = boto3.client('s3',aws_access_key_id=access_key,aws_secret_access_key=secret_key,config=Config(signature_version='s3v4'))
    s3_client = boto3.client('s3',config=Config(signature_version='s3v4'))

    # Bucket del cliente por NIT (fallback al esquema viejo por nombre si no llega el NIT).
    bucket_name = tenant_bucket(nit, document_type) if nit else f'{customer.lower()}.{document_type}'
    # Red de seguridad: asegurar que el bucket exista antes de prefirmar la subida.
    ensure_bucket(s3_client, bucket_name)

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
