'''
Lambda para listar las campañas de un cliente.

Ruta: POST /Campaign/List  (integración no-proxy, envelope estándar)
Request:  { customerId }
Respuesta: 200 { data: { campaigns: [...], count } } ordenadas por fecha (desc)

Cada campaña incluye: campaignId, campaignName, consecutive, channel,
campaignState, dataPath, template, originEmail, date.
'''
import json
import os
import boto3
from decimal import Decimal
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
table_campaign = dynamodb.Table('campaign')


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


def _tenant_from_authorizer(event):
    """customerId/customer que el Authorizer inyecta en el context (CONFIABLE).
    Con integración proxy llega en event.requestContext.authorizer; en no-proxy
    depende de que el mapping template reenvíe $context.authorizer.*. Se prefiere
    sobre el body para evitar que un cliente consulte datos de otro (multi-tenant).
    """
    if not isinstance(event, dict):
        return {}
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return auth if isinstance(auth, dict) else {}


def _clean(value):
    """DynamoDB devuelve los números como Decimal; se pasan a int/float para el JSON.
    RECURSIVO: maneja dicts y listas anidadas (p. ej. `sampleBatches`) para que el
    runtime de Lambda pueda serializar la respuesta (Decimal no es JSON-serializable)."""
    if isinstance(value, Decimal):
        # Entero si no tiene parte decimal; si no, float.
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clean(v) for v in value]
    return value




def _resolve_tenant(event, payload):
    """(customerId, customer) del token (Authorizer). Multi-tenant OBLIGATORIO:
    el tenant nunca sale del body; si el context no llega, el handler deniega."""
    # El tenant SIEMPRE sale del token (Authorizer); NUNCA del body. Si el context
    # no llega (mapping template no desplegado), devuelve None -> el handler deniega.
    a = _tenant_from_authorizer(event) or {}
    return a.get('customerId'), a.get('customer')



# Nombre del GSI por customerId (override por env solo si el índice tiene otro nombre).
# La consulta es SIEMPRE Query por el índice → escalable por defecto (O(resultado), no
# O(tabla)). Si el índice no existe, la operación FALLA en vez de degradar a Scan: así la
# falta del GSI se detecta en el despliegue y nunca se recorre la tabla entera en silencio.
GSI_CUSTOMER_INDEX = os.environ.get('GSI_CUSTOMER_INDEX', 'customerId-index')


def _items_by_customer(_tbl, customer_id, extra_filter=None):
    """Todos los ítems del cliente vía Query por el GSI `customerId-index` (paginado con
    LastEvaluatedKey). Escalable por defecto; si el GSI no existe, propaga el error."""
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
    # Identidad del token (Authorizer); ignora el body si el token trae identidad.
    customer_id, _customer = _resolve_tenant(event, payload)

    if not customer_id:
        return {
            'status': False,
            'statusCode': 400,
            'description': 'Indica el customerId.',
            'data': {'campaigns': [], 'count': 0}
        }

    try:
        items = [_clean(i) for i in _items_by_customer(table_campaign, customer_id)]

        # Orden descendente por fecha ('YYYY-MM-DD HH:MM:SS' ordena como texto).
        items.sort(key=lambda x: x.get('date', ''), reverse=True)

        return {
            'status': True,
            'statusCode': 200,
            'description': 'Campañas del cliente',
            'data': {'campaigns': items, 'count': len(items)}
        }
    except Exception as e:
        print('Error listando campañas: {}'.format(e))
        return {
            'status': False,
            'statusCode': 500,
            'description': 'Error no controlado al listar las campañas',
            'data': {'campaigns': [], 'count': 0}
        }
