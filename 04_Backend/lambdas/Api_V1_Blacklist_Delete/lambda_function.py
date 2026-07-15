'''
Lambda para QUITAR un contacto de la lista negra de un cliente
(tabla {customer}_blackList, PK 'email').

Ruta: POST /Blacklist/Delete  (integración no-proxy, envelope estándar)
Request:  { email (contacto) } + customer/customerId del Authorizer
Respuesta: 200 ok · 400 datos inválidos · 404 no estaba en la lista

Al quitarlo, el contacto vuelve a poder recibir envíos.
'''
import json
import os
import re
import boto3
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table_customer = dynamodb.Table('customer')


def _get_payload(event):
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
    item = table_customer.get_item(Key={'customerId': customer_id},
                                   ProjectionExpression='company').get('Item')
    return item['company'] if item else None


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
    if not contact:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el contacto a quitar.'}

    if STRICT_TENANT and not (auth.get('customer') or auth.get('customerId')):
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.'}

    customer = _safe_table_customer(_customer_name(auth, payload))
    if not customer:
        return {'status': False, 'statusCode': 400, 'description': 'Indica customer o customerId válido.'}

    table = dynamodb.Table(f'{customer}_blackList')
    try:
        existing = table.get_item(Key={'email': contact}).get('Item')
        if not existing:
            return {'status': False, 'statusCode': 404, 'description': 'El contacto no está en la lista negra.'}
        table.delete_item(Key={'email': contact})
        return {'status': True, 'statusCode': 200, 'description': 'Contacto quitado de la lista negra.'}
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return {'status': False, 'statusCode': 404, 'description': 'El contacto no está en la lista negra.'}
        print('Error quitando de la lista negra: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al quitar'}
