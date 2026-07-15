'''
Lambda para listar las bases de datos (CSV) registradas por un cliente.
Lee la metadata de la tabla 'databaseFile' (ver Api_V1_Database_Register-file).

Ruta: POST /Database/List  (integración no-proxy, envelope estándar)
Request:  { customerId }  (o { customer } como alternativa)
Respuesta: 200 { data: { files: [...], count } }  ordenadas por fecha (desc)
'''
import json
import boto3
from decimal import Decimal
from boto3.dynamodb.conditions import Attr

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


def lambda_handler(event, context):
    payload = _get_payload(event)
    auth = _tenant_from_authorizer(event)
    customer_id = auth.get('customerId') or payload.get('customerId')
    customer = auth.get('customer') or payload.get('customer')

    if not customer_id and not customer:
        return {
            'status': False,
            'statusCode': 400,
            'description': 'Indica customerId o customer.',
            'data': {'files': [], 'count': 0}
        }

    try:
        items = []
        # 1) Buscar por customerId (llave principal).
        if customer_id:
            response = table_database.scan(FilterExpression=Attr('customerId').eq(customer_id))
            items = response.get('Items', [])
        # 2) Fallback por nombre de empresa (customer): robusto ante desalineación del
        #    customerId entre el registro y la consulta (p. ej. mapping template del
        #    Authorizer que inyecta un customerId distinto/ vacío). El nombre de empresa
        #    es estable en toda la sesión.
        if not items and customer:
            response = table_database.scan(FilterExpression=Attr('customer').eq(customer))
            items = response.get('Items', [])

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
