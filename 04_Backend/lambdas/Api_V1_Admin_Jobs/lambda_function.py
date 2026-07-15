'''
Lambda ADMIN: monitor de TRABAJOS / COLAS (envíos en curso y recientes).

Da visibilidad operativa de los procesos de envío (tabla `process`), su estado,
progreso (enviados vs. a enviar) y los bloqueos aplicados en la preparación
(lista negra, desuscripciones, inválidos). Es de solo lectura.

Ruta: POST /Admin/Jobs  (integración no-proxy, envelope estándar)
Request:  { month?, state? }
    - month : 'YYYY-MM' para acotar por fecha del proceso. Vacío = recientes.
    - state : filtra por processState (Procesando | Muestras | Terminada | Error).
Respuesta: 200 { data: { jobs:[{processId, campaignId, campaignName, company,
                                channel, channelLabel, processState, campaignState,
                                registersToSend, sent, progress, blocked:{blacklist,
                                unsubscribe, invalid}, parts, date}],
                          counts:{byState}, truncated } }

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.

Nota: la profundidad real de las colas SQS no se lee aquí (requiere permisos SQS y
las URLs de las colas); el "progreso" del trabajo es la señal operativa equivalente
desde la app. Es de solo lectura: el reencolado se hará en una iteración aparte.
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

MAX_JOBS = 200  # tope de procesos enriquecidos con conteo de envíos

CHANNEL_MAP = {
    'EM': 'Correo', 'EAU': 'Correo', 'EAP': 'Correo',
    'SMS': 'SMS', 'WSP': 'WhatsApp', 'VOZ': 'Voz',
}


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            parsed = json.loads(event['body'])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return event if isinstance(event, dict) else {}


def _is_admin(event):
    if not isinstance(event, dict):
        return False
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return str(auth.get('role', '')).lower() == 'admin'


def _to_int(value):
    if isinstance(value, Decimal):
        return int(value)
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _scan_all(table, **kwargs):
    items = []
    try:
        while True:
            resp = table.scan(**kwargs)
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


def _count_sent(company, process_id):
    """Mensajes efectivamente enviados (messageId distinto) del proceso."""
    seen = set()
    table = dynamodb.Table(f'{company}_sendStatus')
    kwargs = {'KeyConditionExpression': Key('processId').eq(process_id),
              'ProjectionExpression': 'messageId'}
    try:
        while True:
            resp = table.query(**kwargs)
            for rec in resp.get('Items', []):
                if rec.get('messageId'):
                    seen.add(rec['messageId'])
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return 0
        raise
    return len(seen)


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}

    payload = _get_payload(event)
    month = str(payload.get('month', '') or '').strip()
    state_filter = str(payload.get('state', '') or '').strip()

    try:
        processes = _scan_all(table_process)
        if month:
            processes = [p for p in processes if str(p.get('date', '')).startswith(month)]
        if state_filter:
            processes = [p for p in processes if str(p.get('processState', '')) == state_filter]

        # Más recientes primero.
        processes.sort(key=lambda p: str(p.get('date', '')), reverse=True)

        # Estado de la campaña (una lectura por campaña, cacheada).
        camp_state = {}
        camp_channel = {}

        def campaign_info(campaign_id):
            if campaign_id in camp_state:
                return camp_state[campaign_id], camp_channel[campaign_id]
            state, channel = '', ''
            if campaign_id:
                # campaignId es la PK de campaign: GetItem O(1) en vez de Scan O(tabla)
                # por cada campaña distinta.
                item = table_campaign.get_item(
                    Key={'campaignId': campaign_id},
                    ProjectionExpression='campaignState, channel').get('Item')
                if item:
                    state = item.get('campaignState', '')
                    channel = item.get('channel', '')
            camp_state[campaign_id] = state
            camp_channel[campaign_id] = channel
            return state, channel

        counts = defaultdict(int)
        jobs = []
        enriched = 0
        truncated = False
        for p in processes:
            pstate = str(p.get('processState', ''))
            counts[pstate or 'Desconocido'] += 1

            company = p.get('customerName', '')
            campaign_id = p.get('campaignId', '')
            cstate, channel = campaign_info(campaign_id)
            to_send = _to_int(p.get('registersToSend'))

            if enriched < MAX_JOBS:
                sent = _count_sent(company, p.get('processId'))
                enriched += 1
            else:
                sent = 0
                truncated = True

            progress = round(sent / to_send, 4) if to_send else (1.0 if sent else 0.0)
            jobs.append({
                'processId': p.get('processId'),
                'campaignId': campaign_id,
                'campaignName': p.get('campaignName', ''),
                'company': company,
                'channel': channel,
                'channelLabel': CHANNEL_MAP.get(channel, channel or '—'),
                'processState': pstate,
                'campaignState': cstate,
                'registersToSend': to_send,
                'sent': sent,
                'progress': progress,
                'blocked': {
                    'blacklist': _to_int(p.get('quantityBlacklist')),
                    'unsubscribe': _to_int(p.get('quantityUnsubscribe')),
                    'invalid': _to_int(p.get('quantityDeletions')),
                },
                'parts': _to_int(p.get('parts')),
                'date': p.get('date', ''),
            })

        return {
            'status': True, 'statusCode': 200,
            'description': 'Trabajos' + (' (parcial)' if truncated else ''),
            'data': {'jobs': jobs, 'counts': dict(counts), 'truncated': truncated}
        }
    except Exception as e:
        print('Error listando trabajos: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al listar los trabajos', 'data': {}}
