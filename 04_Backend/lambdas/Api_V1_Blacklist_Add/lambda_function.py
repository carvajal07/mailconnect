'''
Lambda para AGREGAR un contacto a la lista negra de un cliente
(tabla {customer}_blackList, PK 'email').

Ruta: POST /Blacklist/Add  (integración no-proxy, envelope estándar)
Request:  { email (contacto: correo o celular), reason? } + customer/customerId del Authorizer
Respuesta: 201 ok · 400 datos inválidos

El contacto queda excluido de los envíos reales (Prepare-batch lo filtra). Si la tabla no
existe, se crea con PK 'email' (mismo esquema que usa Prepare-batch/ReceptionStatus).
'''
import json
import os
import re
import time
import uuid
import boto3
from datetime import datetime
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
ddb_client = boto3.client('dynamodb', region_name=REGION)
table_customer = dynamodb.Table('customer')


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _tenant_from_authorizer(event):
    if not isinstance(event, dict):
        return {}
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return auth if isinstance(auth, dict) else {}


def _customer_name(auth, payload):
    customer = auth.get('customer') or payload.get('customer')
    if customer:
        return str(customer).strip()
    customer_id = auth.get('customerId') or payload.get('customerId')
    if not customer_id:
        return None
    resp = table_customer.scan(
        FilterExpression="customerId = :v",
        ExpressionAttributeValues={":v": customer_id},
        ProjectionExpression='company')
    return resp['Items'][0]['company'] if resp['Items'] else None


def _ensure_table(table_name):
    """Crea la tabla {customer}_blackList (PK 'email') si no existe."""
    try:
        ddb_client.describe_table(TableName=table_name)
        return
    except ClientError as e:
        if e.response['Error']['Code'] != 'ResourceNotFoundException':
            raise
    ddb_client.create_table(
        TableName=table_name,
        KeySchema=[{'AttributeName': 'email', 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': 'email', 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')
    waiter = ddb_client.get_waiter('table_exists')
    waiter.wait(TableName=table_name)


STRICT_TENANT = os.environ.get('STRICT_TENANT', 'false').strip().lower() == 'true'


def _resolve_tenant(event, payload):
    """(customerId, customer) a usar en la consulta.
    Si el Authorizer trae identidad, se usa SOLO esa (ignora el body por completo
    para no mezclar tenants). Sin contexto del Authorizer cae al body (legacy)
    salvo STRICT_TENANT=true, que corta el acceso (fail-closed). Actívalo cuando
    el mapping template que inyecta $context.authorizer.* esté desplegado."""
    a = _tenant_from_authorizer(event) or {}
    cid, cust = a.get('customerId'), a.get('customer')
    if cid or cust:
        return cid, cust
    if STRICT_TENANT:
        return None, None
    return payload.get('customerId'), payload.get('customer')




_SAFE_CUSTOMER_RE = re.compile(r"^[A-Za-z0-9_]+$")


def _safe_table_customer(customer):
    """Nombre de empresa validado para usar como prefijo de tabla DynamoDB.
    Evita inyección/confusión de tenant (p. ej. apuntar a la tabla de otro
    cliente o crear tablas arbitrarias). Devuelve None si no es válido."""
    c = (customer or "").strip()
    return c if _SAFE_CUSTOMER_RE.match(c) else None


def lambda_handler(event, context):
    payload = _get_payload(event)
    auth = _tenant_from_authorizer(event)

    contact = str(payload.get('email', '')).strip()
    reason = str(payload.get('reason', 'manual')).strip() or 'manual'

    if not contact:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el contacto (email o celular).'}

    if STRICT_TENANT and not (auth.get('customer') or auth.get('customerId')):
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.'}

    customer = _safe_table_customer(_customer_name(auth, payload))
    if not customer:
        return {'status': False, 'statusCode': 400, 'description': 'Indica customer o customerId válido.'}

    table_name = f'{customer}_blackList'
    now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    try:
        _ensure_table(table_name)
        dynamodb.Table(table_name).put_item(
            Item={
                'email': contact,
                'blackListId': str(uuid.uuid4()),
                'rejectionType': 'manual',
                'description': reason,
                'date': now,
            }
        )
        return {'status': True, 'statusCode': 201, 'description': 'Contacto agregado a la lista negra.',
                'data': {'email': contact}}
    except Exception as e:
        print('Error agregando a la lista negra: {}'.format(e))
        # pequeño respiro por si la tabla se está activando
        time.sleep(0.1)
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al agregar'}
