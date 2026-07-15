'''
Lambda de ARRANQUE del portal (precarga en 1 sola llamada).

Ruta: POST /Portal/Bootstrap  (integración no-proxy, envelope estándar)
Request:  {}  (el tenant SIEMPRE sale del context del Authorizer)
Respuesta: 200 { data: { campaigns[], databases[], blacklist[], messageTemplates[],
                         errors:{dataset: msg} } }

Objetivo: colapsar el "waterfall" de llamadas tras el login (campañas + bases +
lista negra + plantillas de mensaje) en UNA sola petición del navegador. Las
lecturas son server-side (latencia a DynamoDB ~ms), así que aunque vayan en
secuencia dentro de la lambda, son mucho más rápidas que 4 round trips del cliente.

Multi-tenant OBLIGATORIO: sin context del token → 403 (igual que las lambdas de
cada dataset). Cada dataset se lee en su propio try: si uno falla, se devuelve
vacío con su error en `errors`, sin tumbar el resto (precarga tolerante a fallos).

NOTA: las ESTADÍSTICAS (agregación pesada de estados) NO se incluyen aquí a
propósito; el front las carga por separado (tab Estadísticas) para que este
arranque sea liviano.
'''
import re
import json
import boto3
from decimal import Decimal
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_campaign = dynamodb.Table('campaign')
table_database = dynamodb.Table('databaseFile')
table_message = dynamodb.Table('messageTemplate')

_SAFE_CUSTOMER_RE = re.compile(r'^[A-Za-z0-9_]+$')


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def _clean(item):
    '''DynamoDB devuelve números como Decimal; los pasamos a int para el JSON.'''
    out = {}
    for k, v in item.items():
        out[k] = int(v) if isinstance(v, Decimal) else v
    return out


def _scan_all(table, **kwargs):
    '''Scan paginado (recorre LastEvaluatedKey hasta agotar).'''
    items = []
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get('Items', []))
        last = resp.get('LastEvaluatedKey')
        if not last:
            break
        kwargs['ExclusiveStartKey'] = last
    return items


def _load_campaigns(customer_id):
    items = [_clean(i) for i in _scan_all(table_campaign, FilterExpression=Attr('customerId').eq(customer_id))]
    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return items


def _load_databases(customer_id, customer):
    items = []
    if customer_id:
        items = _scan_all(table_database, FilterExpression=Attr('customerId').eq(customer_id))
    if not items and customer:  # fallback por nombre de empresa (desalineación de id)
        items = _scan_all(table_database, FilterExpression=Attr('customer').eq(customer))
    items = [_clean(i) for i in items]
    items.sort(key=lambda x: x.get('uploadDate', ''), reverse=True)
    return items


def _load_message_templates(customer_id):
    items = [_clean(i) for i in _scan_all(table_message, FilterExpression=Attr('customerId').eq(customer_id))]
    items.sort(key=lambda x: x.get('created', ''), reverse=True)
    return items


def _load_blacklist(customer):
    '''Lista negra del cliente ({customer}_blackList). Si no existe la tabla, vacío.'''
    safe = (customer or '').strip()
    if not _SAFE_CUSTOMER_RE.match(safe):
        return []
    table = dynamodb.Table('{}_blackList'.format(safe))
    try:
        items = [_clean(i) for i in _scan_all(table)]
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return []
        raise
    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return items


def lambda_handler(event, context):
    _get_payload(event)  # (no se usan campos del body; el tenant sale del token)
    auth = _authorizer(event)
    customer_id = auth.get('customerId')
    customer = (auth.get('customer') or '').strip()

    # Multi-tenant OBLIGATORIO: sin identidad del token, se deniega.
    if not customer_id and not customer:
        return {'status': False, 'statusCode': 403,
                'description': 'Sesión sin identidad de cliente.',
                'data': {'campaigns': [], 'databases': [], 'blacklist': [], 'messageTemplates': [], 'errors': {}}}

    data = {'campaigns': [], 'databases': [], 'blacklist': [], 'messageTemplates': [], 'errors': {}}

    # Cada dataset en su propio try: un fallo no tumba el resto (precarga tolerante).
    for name, loader in (
        ('campaigns', lambda: _load_campaigns(customer_id)),
        ('databases', lambda: _load_databases(customer_id, customer)),
        ('messageTemplates', lambda: _load_message_templates(customer_id)),
        ('blacklist', lambda: _load_blacklist(customer)),
    ):
        try:
            data[name] = loader()
        except Exception as e:
            print('Bootstrap: fallo cargando {}: {}'.format(name, e))
            data['errors'][name] = 'No se pudo cargar {}.'.format(name)

    return {'status': True, 'statusCode': 200, 'description': 'Datos de arranque del portal', 'data': data}
