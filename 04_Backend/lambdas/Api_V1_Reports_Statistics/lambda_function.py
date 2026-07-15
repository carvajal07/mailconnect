'''
Lambda de ESTADÍSTICAS agregadas por cliente (para el tablero del portal).

NO usa Bedrock (a diferencia de Api_V1_Agent_Reports): lee DynamoDB directo, así
que es barata y se puede llamar cada vez que el cliente abre "Estadísticas".

Ruta: POST /Report/Statistics  (integración no-proxy, envelope estándar)
Request:  { customerId, customer }   (customerId filtra campañas; customer = nombre
          de la empresa, necesario para las tablas {customer}_sendStatus_{proceso})
Respuesta: 200 { data: { campaigns: [CampaignStat], generatedAt } }

CampaignStat = { id, name, estado, rawState, enviados, entregados, abiertos,
                 clics, rebotes, quejas }
  estado ∈ pendiente|creada|enviada  (mapeo del estado real de la campaña)

Cómo se agregan las métricas:
  1. Se listan las campañas del cliente (tabla campaign por customerId).
  2. Se listan sus procesos (tabla process por customerName), agrupados por campaña.
  3. Por cada proceso se lee {customer}_sendStatus_{processId} y se toma el estado
     de MAYOR prioridad por messageId (un mensaje pasa por Enviado→Entregado→Abierto…).
  4. Se cuentan los estados finales y se suman por campaña.
'''
import json
import boto3
from decimal import Decimal
from collections import defaultdict
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table_campaign = dynamodb.Table('campaign')
table_process = dynamodb.Table('process')

# Tope de procesos a agregar por llamada (evita barridos enormes; se registra si trunca).
MAX_PROCESSES = 300

# Prioridad del estado "actual" de un mensaje (mayor gana). Números = tabla de estados.
STATE_PRIORITY = {1: 1, 9: 2, 8: 3, 3: 4, 2: 5, 6: 6, 10: 7, 7: 8, 4: 9, 5: 10}

# Estado de la campaña (backend) -> bucket del tablero (frontend).
#   creada    = borrador recién creada (o en error, para no ocultarla)
#   pendiente = muestras enviadas, por aprobar
#   enviada   = envío real disparado / en curso / terminado
ESTADO_BUCKET = {
    'Pendiente': 'creada',
    'Error': 'creada',
    'Muestras': 'pendiente',
    'Enviando': 'enviada',
    'Procesando': 'enviada',
    'Terminada': 'enviada',
}


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
    Se prefiere sobre el body para que un cliente no vea métricas de otro."""
    if not isinstance(event, dict):
        return {}
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return auth if isinstance(auth, dict) else {}


def _to_int(value):
    if isinstance(value, Decimal):
        return int(value)
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _scan_all(table, **kwargs):
    """Escanea una tabla completa paginando. Devuelve [] si la tabla no existe."""
    items = []
    try:
        while True:
            resp = table.scan(**kwargs)
            items.extend(resp.get('Items', []))
            last_key = resp.get('LastEvaluatedKey')
            if not last_key:
                break
            kwargs['ExclusiveStartKey'] = last_key
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return []
        raise
    return items


def _query_process(table, process_id):
    """Trae los estados de UN proceso desde la tabla única {customer}_sendStatus
    (PK processId). Devuelve [] si la tabla no existe. Reemplaza el scan de la antigua
    tabla-por-proceso."""
    items = []
    kwargs = {'KeyConditionExpression': Key('processId').eq(process_id)}
    try:
        while True:
            resp = table.query(**kwargs)
            items.extend(resp.get('Items', []))
            last_key = resp.get('LastEvaluatedKey')
            if not last_key:
                break
            kwargs['ExclusiveStartKey'] = last_key
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return []
        raise
    return items


def _current_state_per_message(status_records):
    """{messageId: state_num} tomando el estado de mayor prioridad por mensaje."""
    states = {}
    for rec in status_records:
        msg_id = rec.get('messageId') or rec.get('MessageId')
        if not msg_id:
            continue  # registros de pre-filtro (inválido/lista negra) no tienen messageId
        state_num = _to_int(rec.get('state'))
        if msg_id not in states:
            states[msg_id] = state_num
        elif STATE_PRIORITY.get(state_num, 0) > STATE_PRIORITY.get(states[msg_id], 0):
            states[msg_id] = state_num
    return states


def _counts_from_states(states):
    """Cuenta enviados/entregados/abiertos/clics/rebotes/quejas (embudo monótono)."""
    enviados = len(states)
    entregados = abiertos = clics = rebotes = quejas = 0
    for st in states.values():
        if st in (2, 4, 5, 7):   # Entregado, Abierto, Clic, Queja → llegó a entregarse
            entregados += 1
        if st in (4, 5):          # Abierto, Clic
            abiertos += 1
        if st == 5:               # Clic
            clics += 1
        if st in (3, 6):          # Rechazado, Rebote
            rebotes += 1
        if st == 7:               # Queja
            quejas += 1
    return {
        'enviados': enviados, 'entregados': entregados, 'abiertos': abiertos,
        'clics': clics, 'rebotes': rebotes, 'quejas': quejas,
    }


def lambda_handler(event, context):
    payload = _get_payload(event)
    auth = _tenant_from_authorizer(event)
    customer_id = auth.get('customerId') or payload.get('customerId')
    customer = (auth.get('customer') or payload.get('customer') or '').strip()

    if not customer_id or not customer:
        return {
            'status': False, 'statusCode': 400,
            'description': 'Indica customerId y customer.',
            'data': {'campaigns': []}
        }

    try:
        # 1) Campañas del cliente.
        campaigns = _scan_all(table_campaign, FilterExpression=Attr('customerId').eq(customer_id))

        # 2) Procesos del cliente, agrupados por campaña.
        processes = _scan_all(table_process, FilterExpression=Attr('customerName').eq(customer))
        procs_by_campaign = defaultdict(list)
        for p in processes:
            procs_by_campaign[p.get('campaignId')].append(p)

        # 3) Agregación por campaña (con tope de procesos).
        result = []
        scanned = 0
        truncated = False
        for c in campaigns:
            campaign_id = c.get('campaignId')
            raw_state = c.get('campaignState', 'Pendiente')
            totals = {'enviados': 0, 'entregados': 0, 'abiertos': 0, 'clics': 0, 'rebotes': 0, 'quejas': 0}

            for proc in procs_by_campaign.get(campaign_id, []):
                if scanned >= MAX_PROCESSES:
                    truncated = True
                    break
                process_id = proc.get('processId')
                if not process_id:
                    continue
                scanned += 1
                status_table = dynamodb.Table(f'{customer}_sendStatus')
                states = _current_state_per_message(_query_process(status_table, process_id))
                counts = _counts_from_states(states)
                for k in totals:
                    totals[k] += counts[k]

            result.append({
                'id': campaign_id,
                'name': c.get('campaignName', ''),
                'estado': ESTADO_BUCKET.get(raw_state, 'creada'),
                'rawState': raw_state,
                'date': c.get('date', ''),
                **totals,
            })

        # Orden descendente por fecha.
        result.sort(key=lambda x: x.get('date', ''), reverse=True)

        if truncated:
            print(f'ADVERTENCIA: se alcanzó el tope de {MAX_PROCESSES} procesos; métricas parciales.')

        return {
            'status': True, 'statusCode': 200,
            'description': 'Estadísticas del cliente' + (' (parciales)' if truncated else ''),
            'data': {'campaigns': result, 'truncated': truncated}
        }
    except Exception as e:
        print('Error en estadísticas: {}'.format(e))
        return {
            'status': False, 'statusCode': 500,
            'description': 'Error no controlado al calcular las estadísticas',
            'data': {'campaigns': []}
        }
