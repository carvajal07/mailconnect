'''
Lambda de ARRANQUE del portal (precarga en 1 sola llamada).

Ruta: POST /Portal/Bootstrap  (integración no-proxy, envelope estándar)
Request:  {}  (el tenant SIEMPRE sale del context del Authorizer)
Respuesta: 200 { data: { campaigns[], databases[], blacklist[], messageTemplates[],
                         stats[], errors:{dataset: msg} } }

Objetivo: colapsar el "waterfall" de llamadas tras el login (campañas + bases +
lista negra + plantillas de mensaje) en UNA sola petición del navegador. Las
lecturas son server-side (latencia a DynamoDB ~ms), así que aunque vayan en
secuencia dentro de la lambda, son mucho más rápidas que 4 round trips del cliente.

Multi-tenant OBLIGATORIO: sin context del token → 403 (igual que las lambdas de
cada dataset). Cada dataset se lee en su propio try: si uno falla, se devuelve
vacío con su error en `errors`, sin tumbar el resto (precarga tolerante a fallos).

Las ESTADÍSTICAS (agregación de estados de envío) se incluyen con el MISMO cálculo
que Api_V1_Reports_Statistics (mantener en sync). Es la parte más pesada, así que
se carga al final; a futuro, con pre-agregación de contadores, sería O(1).
'''
import os
import re
import json
import boto3
from decimal import Decimal
from collections import defaultdict
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

# Lee el RESUMEN pre-agregado por proceso ({customer}_sendSummary) en vez de escanear
# los estados de cada mensaje. Gated: actívalo SOLO tras habilitar la escritura
# (SEND_SUMMARY_ENABLED en ReceptionStatus) y hacer backfill de los procesos existentes.
SEND_SUMMARY_READ = os.environ.get('SEND_SUMMARY_READ', 'false').strip().lower() == 'true'
_SUMMARY_FIELDS = ('enviados', 'entregados', 'abiertos', 'clics', 'rebotes', 'quejas')

dynamodb = boto3.resource('dynamodb')
table_campaign = dynamodb.Table('campaign')
table_database = dynamodb.Table('databaseFile')
table_message = dynamodb.Table('messageTemplate')
table_process = dynamodb.Table('process')

# GSI por customerId (mismas envs que Api_V1_Campaign_List: al poner USE_GSI=true, las
# lecturas por cliente pasan de Scan O(tabla) a Query O(resultado)). Cada tabla debe tener
# un índice con el nombre GSI_CUSTOMER_INDEX (PK 'customerId'). Sin el índice/env, cae a Scan.
USE_GSI = os.environ.get('USE_GSI', 'false').strip().lower() == 'true'
GSI_CUSTOMER_INDEX = os.environ.get('GSI_CUSTOMER_INDEX', 'customerId-index')

_SAFE_CUSTOMER_RE = re.compile(r'^[A-Za-z0-9_]+$')

# --- Estadísticas: MISMA lógica que Api_V1_Reports_Statistics (mantener en sync) ---
MAX_PROCESSES = 300
STATE_PRIORITY = {1: 1, 9: 2, 8: 3, 3: 4, 2: 5, 6: 6, 10: 7, 7: 8, 4: 9, 5: 10}
ESTADO_BUCKET = {
    'Pendiente': 'creada', 'Error': 'creada', 'Muestras': 'pendiente',
    'Enviando': 'enviada', 'Procesando': 'enviada', 'Terminada': 'enviada',
}


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


def _by_customer(table, customer_id):
    '''Items del cliente: Query por el GSI customerId si USE_GSI, si no Scan+filter.
    Ambos caminos paginan (LastEvaluatedKey).'''
    items = []
    if USE_GSI:
        kwargs = {'IndexName': GSI_CUSTOMER_INDEX,
                  'KeyConditionExpression': Key('customerId').eq(customer_id)}
        op = table.query
    else:
        kwargs = {'FilterExpression': Attr('customerId').eq(customer_id)}
        op = table.scan
    while True:
        resp = op(**kwargs)
        items.extend(resp.get('Items', []))
        last = resp.get('LastEvaluatedKey')
        if not last:
            break
        kwargs['ExclusiveStartKey'] = last
    return items


def _load_campaigns(customer_id):
    items = [_clean(i) for i in _by_customer(table_campaign, customer_id)]
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


def _to_int(value):
    if isinstance(value, Decimal):
        return int(value)
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _query_process(table, process_id):
    '''Estados de UN proceso desde {customer}_sendStatus (PK processId). [] si no existe.'''
    items = []
    kwargs = {'KeyConditionExpression': Key('processId').eq(process_id)}
    try:
        while True:
            resp = table.query(**kwargs)
            items.extend(resp.get('Items', []))
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return []
        raise
    return items


def _current_state_per_message(records):
    '''{messageId: state} tomando el estado de mayor prioridad por mensaje.'''
    states = {}
    for rec in records:
        msg_id = rec.get('messageId') or rec.get('MessageId')
        if not msg_id:
            continue
        st = _to_int(rec.get('state'))
        if msg_id not in states or STATE_PRIORITY.get(st, 0) > STATE_PRIORITY.get(states[msg_id], 0):
            states[msg_id] = st
    return states


def _counts_from_states(states):
    enviados = len(states)
    entregados = abiertos = clics = rebotes = quejas = 0
    for st in states.values():
        if st in (2, 4, 5, 7):
            entregados += 1
        if st in (4, 5):
            abiertos += 1
        if st == 5:
            clics += 1
        if st in (3, 6):
            rebotes += 1
        if st == 7:
            quejas += 1
    return {'enviados': enviados, 'entregados': entregados, 'abiertos': abiertos,
            'clics': clics, 'rebotes': rebotes, 'quejas': quejas}


def _load_stats(customer_id, customer):
    '''Estadísticas por campaña (mismo cálculo que Reports_Statistics). Requiere
    customer (nombre de empresa) para la tabla {customer}_sendStatus.'''
    if not customer_id or not customer:
        return []
    campaigns = _by_customer(table_campaign, customer_id)
    processes = _scan_all(table_process, FilterExpression=Attr('customerName').eq(customer))
    procs_by_campaign = defaultdict(list)
    for p in processes:
        procs_by_campaign[p.get('campaignId')].append(p)

    status_table = dynamodb.Table('{}_sendStatus'.format(customer))
    summary_table = dynamodb.Table('{}_sendSummary'.format(customer))

    def _counts_for(process_id):
        # 1) Resumen pre-agregado (O(1)) si está activo y existe para este proceso.
        if SEND_SUMMARY_READ:
            try:
                item = summary_table.get_item(Key={'processId': process_id}).get('Item')
            except Exception:
                item = None
            if item:
                return {k: _to_int(item.get(k, 0)) for k in _SUMMARY_FIELDS}
        # 2) Fallback: agregación por scan de los estados del proceso.
        return _counts_from_states(_current_state_per_message(_query_process(status_table, process_id)))

    result = []
    scanned = 0
    for c in campaigns:
        campaign_id = c.get('campaignId')
        raw_state = c.get('campaignState', 'Pendiente')
        totals = {'enviados': 0, 'entregados': 0, 'abiertos': 0, 'clics': 0, 'rebotes': 0, 'quejas': 0}
        for proc in procs_by_campaign.get(campaign_id, []):
            if scanned >= MAX_PROCESSES:
                break
            process_id = proc.get('processId')
            if not process_id:
                continue
            scanned += 1
            counts = _counts_for(process_id)
            for k in totals:
                totals[k] += counts[k]
        result.append({
            'id': campaign_id, 'name': c.get('campaignName', ''),
            'estado': ESTADO_BUCKET.get(raw_state, 'creada'), 'rawState': raw_state,
            'date': c.get('date', ''), **totals,
        })
    result.sort(key=lambda x: x.get('date', ''), reverse=True)
    return result


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
    empty = {'campaigns': [], 'databases': [], 'blacklist': [], 'messageTemplates': [], 'stats': [], 'errors': {}}
    if not customer_id and not customer:
        return {'status': False, 'statusCode': 403,
                'description': 'Sesión sin identidad de cliente.', 'data': empty}

    data = dict(empty)

    # Cada dataset en su propio try: un fallo no tumba el resto (precarga tolerante).
    # 'stats' va al final por ser el más pesado (agregación de estados de envío).
    for name, loader in (
        ('campaigns', lambda: _load_campaigns(customer_id)),
        ('databases', lambda: _load_databases(customer_id, customer)),
        ('messageTemplates', lambda: _load_message_templates(customer_id)),
        ('blacklist', lambda: _load_blacklist(customer)),
        ('stats', lambda: _load_stats(customer_id, customer)),
    ):
        try:
            data[name] = loader()
        except Exception as e:
            print('Bootstrap: fallo cargando {}: {}'.format(name, e))
            data['errors'][name] = 'No se pudo cargar {}.'.format(name)

    return {'status': True, 'statusCode': 200, 'description': 'Datos de arranque del portal', 'data': data}
