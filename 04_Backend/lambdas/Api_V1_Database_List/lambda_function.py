'''
Lambda para listar las bases de datos (CSV) registradas por un cliente.
Lee la metadata de la tabla 'databaseFile' (ver Api_V1_Database_Register-file).

Ruta: POST /Database/List  (integración no-proxy, envelope estándar)
Request:  { customerId }  (o { customer } como alternativa)
Respuesta: 200 { data: { files: [...], count } }  ordenadas por fecha (desc)
'''
import json
import os
import boto3
from decimal import Decimal
from boto3.dynamodb.conditions import Attr, Key

dynamodb = boto3.resource('dynamodb')
table_database = dynamodb.Table('databaseFile')


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
    """customerId/customer del context del Authorizer (CONFIABLE, multi-tenant).
    Se prefiere sobre el body para que un cliente no consulte datos de otro."""
    if not isinstance(event, dict):
        return {}
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return auth if isinstance(auth, dict) else {}


def _clean(item):
    """DynamoDB devuelve los números como Decimal; los pasamos a int para el JSON."""
    out = {}
    for key, value in item.items():
        out[key] = int(value) if isinstance(value, Decimal) else value
    return out




def _resolve_tenant(event, payload):
    """(customerId, customer) del token (Authorizer). Multi-tenant OBLIGATORIO:
    el tenant nunca sale del body; si el context no llega, el handler deniega."""
    # El tenant SIEMPRE sale del token (Authorizer); NUNCA del body. Si el context
    # no llega (mapping template no desplegado), devuelve None -> el handler deniega.
    a = _tenant_from_authorizer(event) or {}
    return a.get('customerId'), a.get('customer')



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
    customer_id, customer = _resolve_tenant(event, payload)

    if not customer_id and not customer:
        return {
            'status': False,
            'statusCode': 400,
            'description': 'Indica customerId o customer.',
            'data': {'files': [], 'count': 0}
        }

    try:
        items = []
        # 1) Buscar por customerId (llave principal): Query por GSI si USE_GSI, si no
        #    Scan paginado.
        if customer_id:
            items = _items_by_customer(table_database, customer_id)
        # 2) Fallback por nombre de empresa (customer): robusto ante desalineación del
        #    customerId entre el registro y la consulta. Scan paginado (no hay GSI por
        #    nombre); antes no paginaba y podía truncar el listado.
        if not items and customer:
            kwargs = {'FilterExpression': Attr('customer').eq(customer)}
            while True:
                response = table_database.scan(**kwargs)
                items.extend(response.get('Items', []))
                last = response.get('LastEvaluatedKey')
                if not last:
                    break
                kwargs['ExclusiveStartKey'] = last

        items = [_clean(i) for i in items]
        # Orden descendente por fecha de carga (ISO -> ordena como texto)
        items.sort(key=lambda x: x.get('uploadDate', ''), reverse=True)

        return {
            'status': True,
            'statusCode': 200,
            'description': 'Bases de datos del cliente',
            'data': {'files': items, 'count': len(items)}
        }
    except Exception as e:
        print("Error listando bases: {}".format(e))
        return {
            'status': False,
            'statusCode': 500,
            'description': 'Error no controlado al listar las bases de datos',
            'data': {'files': [], 'count': 0}
        }
