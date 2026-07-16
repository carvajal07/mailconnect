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


def tenant_key(nit):
    """Llave de tenant (NIT saneado) para la tabla {tenant}_blackList del cliente. Igual
    que en Prepare-batch/buckets. Idempotente."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def _resolve_nit(auth, payload):
    """NIT (companyTin) del cliente: del context del Authorizer (claim `nit`) o resuelto
    desde customerId. Es la llave de la tabla {tenant}_blackList (via tenant_key)."""
    nit = auth.get('nit') or payload.get('nit')
    if nit:
        return str(nit)
    customer_id = auth.get('customerId') or payload.get('customerId')
    if not customer_id:
        return None
    item = table_customer.get_item(Key={'customerId': customer_id},
                                   ProjectionExpression='companyTin').get('Item')
    return str(item['companyTin']) if item and item.get('companyTin') else None




def _resolve_tenant(event, payload):
    """(customerId, customer) del token (Authorizer). Multi-tenant OBLIGATORIO:
    el tenant nunca sale del body; si el context no llega, el handler deniega."""
    # El tenant SIEMPRE sale del token (Authorizer); NUNCA del body. Si el context
    # no llega (mapping template no desplegado), devuelve None -> el handler deniega.
    a = _tenant_from_authorizer(event) or {}
    return a.get('customerId'), a.get('customer')




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

    if not (auth.get('nit') or auth.get('customerId')):
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.'}

    # La tabla se nombra por NIT saneado (tenant_key), igual que buckets y el resto de tablas.
    tenant = _safe_table_customer(tenant_key(_resolve_nit(auth, payload) or ''))
    if not tenant:
        return {'status': False, 'statusCode': 400, 'description': 'Indica customer o customerId válido.'}

    table = dynamodb.Table(f'{tenant}_blackList')
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
