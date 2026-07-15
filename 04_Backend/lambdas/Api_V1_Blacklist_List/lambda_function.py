'''
Lambda para listar la LISTA NEGRA de un cliente (tabla {customer}_blackList, PK 'email').

La lista negra son contactos (correo o celular) a los que NO se les debe enviar. La llena
automáticamente Api_V1_Email_ReceptionStatus (rebotes permanentes) y el cliente puede
gestionarla manualmente. Prepare-batch la filtra en el envío real.

Ruta: POST /Blacklist/List  (integración no-proxy, envelope estándar)
Request:  { customer } o { customerId }  (se prefiere el context del Authorizer)
Respuesta: 200 { data: { items: [{ email, rejectionType, description, date }], count } }
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


def _customer_name(payload):
    """Nombre de empresa: del body directo o resuelto desde customerId."""
    customer = payload.get('customer')
    if customer:
        return str(customer).strip()
    customer_id = payload.get('customerId')
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
    if auth.get('customer') or auth.get('customerId'):
        payload = {'customer': auth.get('customer'), 'customerId': auth.get('customerId')}
    elif STRICT_TENANT:
        return {'status': False, 'statusCode': 403,
                'description': 'Sesión sin identidad de cliente.', 'data': {'items': [], 'count': 0}}

    customer = _safe_table_customer(_customer_name(payload))
    if not customer:
        return {'status': False, 'statusCode': 400,
                'description': 'Indica customer o customerId válido.', 'data': {'items': [], 'count': 0}}

    table = dynamodb.Table(f'{customer}_blackList')
    try:
        items = []
        kwargs = {}
        while True:
            resp = table.scan(**kwargs)
            items.extend(resp.get('Items', []))
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last
        items.sort(key=lambda x: x.get('date', ''), reverse=True)
        return {'status': True, 'statusCode': 200, 'description': 'Lista negra del cliente',
                'data': {'items': items, 'count': len(items)}}
    except ClientError as e:
        # Si la tabla no existe todavía, la lista negra está vacía (no es un error).
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return {'status': True, 'statusCode': 200, 'description': 'Lista negra vacía',
                    'data': {'items': [], 'count': 0}}
        print('Error listando la lista negra: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al listar', 'data': {'items': [], 'count': 0}}
