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
STRICT_TENANT = os.environ.get('STRICT_TENANT', 'false').strip().lower() == 'true'
# Tipos de documento permitidos (evita apuntar a buckets arbitrarios por doc_type).
ALLOWED_DOC_TYPES = {'database', 'document'}
# Duración corta para el PUT prefirmado (antes 1 h).
PRESIGN_EXPIRES = int(os.environ.get('PRESIGN_EXPIRES', '600'))


def tenant_bucket(nit, doc_type):
    clean = re.sub(r'[^a-z0-9]', '', str(nit or '').lower())
    return '{}-{}-{}'.format(BUCKET_PREFIX, clean, doc_type)


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def _safe_name(name):
    """basename saneado (evita path traversal y elección de key arbitraria)."""
    base = os.path.basename(str(name or '').replace('\\', '/'))
    return base if re.match(r'^[A-Za-z0-9._-]{1,128}$', base) else None


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
    description = "Url creada correctamente"
    status_code = 200
    url = None

    # Identidad del token: el NIT/cliente que define el bucket debe salir del
    # Authorizer, NO del body (si no, un cliente pediría una URL de subida al
    # bucket de otro tenant). Sin contexto se cae al body (legacy) salvo STRICT.
    auth = _authorizer(event)
    auth_nit = auth.get('nit') or auth.get('companyTin')
    auth_customer = auth.get('customer')
    if auth_nit or auth_customer:
        nit = auth_nit
        customer = auth_customer or ''
    elif STRICT_TENANT:
        return {'status': False, 'statusCode': 403,
                'description': 'Sesión sin identidad de cliente.', 'data': {}}
    else:
        customer = event.get('customer', '')
        nit = event.get('nit') or event.get('companyTin')

    document_name = _safe_name(event.get('documentName'))
    document_type = str(event.get('documentType', '')).strip().lower()

    # Validar que se proporcionaron los datos necesarios
    if document_type not in ALLOWED_DOC_TYPES or (not nit and not customer):
        return {
            'statusCode': 400,
            'body': json.dumps('Faltan datos requeridos: nit/cliente, documentType')
        }
    if not document_name:
        return {'statusCode': 400, 'body': json.dumps('documentName inválido')}

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
            ExpiresIn=PRESIGN_EXPIRES
        )
        # No se loguea la URL firmada (permitiría subir archivos a quien lea los logs).
        print(f"URL prefirmada generada para bucket={bucket_name} key={path}")
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
