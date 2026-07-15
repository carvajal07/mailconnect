'''
Lambda para registrar la metadata de una base de datos (CSV) que el cliente ya
subió a S3 (bucket {customer}.database). No maneja el archivo; solo guarda sus datos
(nombre, ruta, cantidad de registros, válidos/ inválidos, fecha, etc.) en la tabla
'databaseFile', para poder listarlas después sin volver a subir el archivo.

Ruta: POST /Database/Register-file  (integración no-proxy, envelope estándar)
Request:
    {
      customerId, customer, fileName, s3Path,
      totalRecords?, validEmails?, invalidEmails?, duplicates?,
      delimiter?, channel?, columns?, uploadedBy?
    }
`columns` es la lista de encabezados del CSV (los campos usables como variables
`{{campo}}` en las plantillas). El front la toma del análisis del archivo al subirlo.
Respuesta: 201 { data: { databaseFileId } }
'''
import uuid
import os
import json
import boto3
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
table_database = dynamodb.Table('databaseFile')


def _get_payload(event):
    """Soporta integración directa (event = body) y Lambda-proxy (event['body'])."""
    # API Gateway (mapping template) puede inyectar el body como OBJETO JSON
    # (integración no-proxy) o como STRING (proxy). Se aceptan ambos.
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _tenant_from_authorizer(event):
    """customerId/customer del context del Authorizer (si llega). Se prefiere sobre el
    body para que Register y List usen la MISMA identidad (evita listados vacíos)."""
    if not isinstance(event, dict):
        return {}
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return auth if isinstance(auth, dict) else {}




def _resolve_tenant(event, payload):
    """(customerId, customer) del token (Authorizer). Multi-tenant OBLIGATORIO:
    el tenant nunca sale del body; si el context no llega, el handler deniega."""
    # El tenant SIEMPRE sale del token (Authorizer); NUNCA del body. Si el context
    # no llega (mapping template no desplegado), devuelve None -> el handler deniega.
    a = _tenant_from_authorizer(event) or {}
    return a.get('customerId'), a.get('customer')



def lambda_handler(event, context):
    status = True
    description = "Base de datos registrada correctamente"
    status_code = 201
    database_file_id = ""

    now = datetime.utcnow()
    formatted_date = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    payload = _get_payload(event)
    tenant_id, tenant_customer = _resolve_tenant(event, payload)
    if not (tenant_id or tenant_customer):
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.'}

    # Encabezados del CSV (campos usables como {{variables}}). Se normaliza a lista de str.
    raw_columns = payload.get('columns', [])
    columns = [str(c) for c in raw_columns] if isinstance(raw_columns, list) else []

    # Campos obligatorios (customerId/customer prefieren el context del Authorizer).
    try:
        customer_id = tenant_id or payload['customerId']
        customer = tenant_customer or payload['customer']
        file_name = payload['fileName']
        s3_path = payload['s3Path']
    except (KeyError, TypeError):
        return {
            'status': False,
            'statusCode': 400,
            'description': 'Faltan campos obligatorios: customerId, customer, fileName, s3Path.',
            'data': {}
        }

    try:
        database_file_id = str(uuid.uuid4())
        table_database.put_item(
            Item={
                'databaseFileId': database_file_id,
                'customerId': customer_id,
                'customer': customer,
                'fileName': file_name,
                's3Path': s3_path,
                'totalRecords': _to_int(payload.get('totalRecords')),
                'validEmails': _to_int(payload.get('validEmails')),
                'invalidEmails': _to_int(payload.get('invalidEmails')),
                'duplicates': _to_int(payload.get('duplicates')),
                'delimiter': payload.get('delimiter', ';'),
                # Canal para el que se validó la base (EMAIL/SMS/WHATSAPP/VOICE).
                # Define qué es la columna 2 (correo o celular).
                'channel': payload.get('channel', 'EMAIL'),
                # Encabezados del CSV: los campos que se pueden usar como {{variables}}
                # en las plantillas. Se guardan como texto para reusarlos sin releer el CSV.
                'columns': columns,
                'uploadedBy': payload.get('uploadedBy', ''),
                'uploadDate': formatted_date,
                'status': 'activa'
            }
        )
    except Exception as e:
        print("Error registrando la base: {}".format(e))
        status = False
        status_code = 500
        description = "Error no controlado al registrar la base de datos"

    return {
        'status': status,
        'statusCode': status_code,
        'description': description,
        'data': {'databaseFileId': database_file_id}
    }
