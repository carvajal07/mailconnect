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




def _resolve_tenant(event, payload):
    """(customerId, customer) del token (Authorizer). Multi-tenant OBLIGATORIO:
    el tenant nunca sale del body; si el context no llega, el handler deniega."""
    # El tenant SIEMPRE sale del token (Authorizer); NUNCA del body. Si el context
    # no llega (mapping template no desplegado), devuelve None -> el handler deniega.
    a = _tenant_from_authorizer(event) or {}
    return a.get('customerId'), a.get('customer')



# Nombre del GSI por customerId (override por env solo si el índice tiene otro nombre).
# La consulta es SIEMPRE Query por el índice → escalable por defecto. Si el índice no
# existe, FALLA (no cae a Scan): la falta del GSI se detecta en el despliegue.
GSI_CUSTOMER_INDEX = os.environ.get('GSI_CUSTOMER_INDEX', 'customerId-index')


def _items_by_customer(_tbl, customer_id, extra_filter=None):
    """Todos los ítems del cliente vía Query por el GSI `customerId-index` (paginado).
    Escalable por defecto; si el GSI no existe, propaga el error."""
    items = []
    kwargs = {'IndexName': GSI_CUSTOMER_INDEX,
              'KeyConditionExpression': Key('customerId').eq(customer_id)}
    if extra_filter is not None:
        kwargs['FilterExpression'] = extra_filter
    while True:
        resp = _tbl.query(**kwargs)
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
