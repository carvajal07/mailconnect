'''
Lambda para listar las plantillas de mensaje (SMS / WSP / DOCX) de un cliente.

Ruta: POST /MessageTemplate/List  (integración no-proxy, envelope estándar)
Request:  { customerId, channel? }  channel opcional filtra por canal (SMS|WSP|DOCX)
Respuesta: 200 { data: { templates: [...], count } } (desc por fecha de creación)

customerId se prefiere del context del Authorizer (multi-tenant): un cliente solo ve
sus plantillas.
'''
import json
import os
import boto3
from boto3.dynamodb.conditions import Attr, Key

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('messageTemplate')


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



USE_GSI = os.environ.get('USE_GSI', 'false').strip().lower() == 'true'
# Nombre del GSI por customerId (override por env al desplegarlo). Cuando USE_GSI=true
# la consulta es Query O(resultado); si no, cae a Scan paginado O(tabla) (correcto,
# pero costoso). Así el código queda listo para el GSI sin romper hoy.
GSI_CUSTOMER_INDEX = os.environ.get('GSI_CUSTOMER_INDEX', 'customerId-index')


def _items_by_customer(_tbl, customer_id, extra_filter=None):
    """Devuelve todos los ítems del cliente (paginado). Query por GSI si USE_GSI,
    si no Scan con FilterExpression. En ambos casos pagina con LastEvaluatedKey."""
    items = []
    if USE_GSI:
        kwargs = {'IndexName': GSI_CUSTOMER_INDEX,
                  'KeyConditionExpression': Key('customerId').eq(customer_id)}
        if extra_filter is not None:
            kwargs['FilterExpression'] = extra_filter
        op = _tbl.query
    else:
        expr = Attr('customerId').eq(customer_id)
        if extra_filter is not None:
            expr = expr & extra_filter
        kwargs = {'FilterExpression': expr}
        op = _tbl.scan
    while True:
        resp = op(**kwargs)
        items.extend(resp.get('Items', []))
        last = resp.get('LastEvaluatedKey')
        if not last:
            break
        kwargs['ExclusiveStartKey'] = last
    return items


def lambda_handler(event, context):
    payload = _get_payload(event)
    customer_id, _customer = _resolve_tenant(event, payload)
    channel = payload.get('channel')
    channel = str(channel).upper() if channel else None

    if not customer_id:
        return {'status': False, 'statusCode': 400,
                'description': 'Indica el customerId.', 'data': {'templates': [], 'count': 0}}

    try:
        extra = Attr('channel').eq(channel) if channel else None
        items = _items_by_customer(table, customer_id, extra_filter=extra)
        items.sort(key=lambda x: x.get('created', ''), reverse=True)

        return {
            'status': True,
            'statusCode': 200,
            'description': 'Plantillas de mensaje del cliente',
            'data': {'templates': items, 'count': len(items)}
        }
    except Exception as e:
        print('Error listando plantillas de mensaje: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al listar', 'data': {'templates': [], 'count': 0}}
