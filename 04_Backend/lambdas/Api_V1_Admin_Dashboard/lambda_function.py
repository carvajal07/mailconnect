'''
Lambda ADMIN: PANEL DE CONTROL GLOBAL de la plataforma.

Agrega métricas macro de TODOS los clientes (no acotado por tenant): volumen de
envíos, embudo de entrega, desglose por canal y SALUD DE ENVÍOS / reputación
(tasas de rebote y queja por cliente, con alerta cuando se acercan a los umbrales
de SES). Complementa a Api_V1_Reports_Statistics (que es por-cliente).

Ruta: POST /Admin/Dashboard  (integración no-proxy, envelope estándar)
Request:  { month? }   month = 'YYYY-MM' para acotar por fecha de campaña. Vacío = todo.
Respuesta: 200 { data: { month, kpis, funnel[], byChannel[], health[], truncated } }

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.

Umbrales de reputación (referencia AWS SES, aplican sobre todo al correo):
  rebote   > 5%  = atención · > 10% = crítico
  queja    > 0.1% = atención · > 0.5% = crítico
'''
import json
import boto3
from decimal import Decimal
from collections import defaultdict
from datetime import datetime, timezone
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table_customer = dynamodb.Table('customer')
table_campaign = dynamodb.Table('campaign')
table_process = dynamodb.Table('process')

MAX_PROCESSES = 500  # tope global de procesos agregados por llamada

# Prioridad del estado "actual" de un mensaje (mayor gana). Igual que Statistics.
STATE_PRIORITY = {1: 1, 9: 2, 8: 3, 3: 4, 2: 5, 6: 6, 10: 7, 7: 8, 4: 9, 5: 10}

# Estados de campaña considerados "activos" / "pendientes" para los KPIs.
ACTIVE_STATES = ('Enviando', 'Procesando')
PENDING_STATES = ('Pendiente', 'Muestras')

# channel de la campaña -> (clave de canal, etiqueta).
CHANNEL_MAP = {
    'EM': ('EMAIL', 'Correo'), 'EAU': ('EMAIL', 'Correo'), 'EAP': ('EMAIL', 'Correo'),
    'SMS': ('SMS', 'SMS'), 'WSP': ('WHATSAPP', 'WhatsApp'), 'VOZ': ('VOICE', 'Voz'),
}

# Umbrales de reputación (fracción sobre enviados).
BOUNCE_WARN, BOUNCE_CRIT = 0.05, 0.10
COMPLAINT_WARN, COMPLAINT_CRIT = 0.001, 0.005


def _get_payload(event):
    # API Gateway (mapping template) puede inyectar el body como OBJETO JSON
    # (integración no-proxy) o como STRING (proxy). Se aceptan ambos.
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
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


def _states_of_process(status_table, process_id):
    """{messageId: estado_de_mayor_prioridad} para un proceso. {} si no hay tabla."""
    states = {}
    kwargs = {'KeyConditionExpression': Key('processId').eq(process_id),
              'ProjectionExpression': 'messageId, #s',
              'ExpressionAttributeNames': {'#s': 'state'}}
    try:
        while True:
            resp = status_table.query(**kwargs)
            for rec in resp.get('Items', []):
                mid = rec.get('messageId')
                if not mid:
                    continue
                st = _to_int(rec.get('state'))
                if mid not in states or STATE_PRIORITY.get(st, 0) > STATE_PRIORITY.get(states[mid], 0):
                    states[mid] = st
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return {}
        raise
    return states


def _accumulate(states, acc):
    """Suma enviados/entregados/abiertos/clics/rebotes/quejas de un dict de estados."""
    for st in states.values():
        acc['sent'] += 1
        if st in (2, 4, 5, 7):
            acc['delivered'] += 1
        if st in (4, 5):
            acc['opened'] += 1
        if st == 5:
            acc['clicked'] += 1
        if st in (3, 6):
            acc['bounces'] += 1
        if st == 7:
            acc['complaints'] += 1


# Llaves del dashboard -> campos del resumen pre-agregado ({customer}_sendSummary).
_SUMMARY_MAP = {'sent': 'enviados', 'delivered': 'entregados', 'opened': 'abiertos',
                'clicked': 'clics', 'bounces': 'rebotes', 'complaints': 'quejas'}


def _counts_for_process(company, process_id):
    """Contadores del proceso: RESUMEN pre-agregado (O(1)) por defecto; si el proceso no
    tiene resumen aún, agregación por Query de sus estados (acotada a ESE proceso)."""
    try:
        item = dynamodb.Table(f'{company}_sendSummary').get_item(
            Key={'processId': process_id}).get('Item')
    except Exception:
        item = None
    if item:
        return {dk: _to_int(item.get(sk, 0)) for dk, sk in _SUMMARY_MAP.items()}
    acc = {'sent': 0, 'delivered': 0, 'opened': 0, 'clicked': 0, 'bounces': 0, 'complaints': 0}
    _accumulate(_states_of_process(dynamodb.Table(f'{company}_sendStatus'), process_id), acc)
    return acc


def _health_level(sent, bounces, complaints):
    if sent <= 0:
        return 'ok', 'Sin envíos'
    br = bounces / sent
    cr = complaints / sent
    if br >= BOUNCE_CRIT or cr >= COMPLAINT_CRIT:
        return 'critical', 'Rebotes {:.1%} · quejas {:.2%}'.format(br, cr)
    if br >= BOUNCE_WARN or cr >= COMPLAINT_WARN:
        return 'warning', 'Rebotes {:.1%} · quejas {:.2%}'.format(br, cr)
    return 'ok', 'Rebotes {:.1%} · quejas {:.2%}'.format(br, cr)


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}

    payload = _get_payload(event)
    month = str(payload.get('month', '') or '').strip()

    try:
        customers = _scan_all(table_customer, ProjectionExpression='customerId, company, companyTin')

        totals = {'sent': 0, 'delivered': 0, 'opened': 0, 'clicked': 0, 'bounces': 0, 'complaints': 0}
        by_channel = defaultdict(lambda: {'sent': 0, 'label': ''})
        active_campaigns = 0
        pending_campaigns = 0
        health = []
        budget = MAX_PROCESSES
        truncated = False

        for cust in customers:
            customer_id = cust.get('customerId')
            company = cust.get('company', '')

            campaigns = _scan_all(table_campaign, FilterExpression=Attr('customerId').eq(customer_id))
            if month:
                campaigns = [c for c in campaigns if str(c.get('date', '')).startswith(month)]

            processes = _scan_all(table_process, FilterExpression=Attr('customerName').eq(company))
            procs_by_campaign = defaultdict(list)
            for p in processes:
                procs_by_campaign[p.get('campaignId')].append(p)

            cust_acc = {'sent': 0, 'delivered': 0, 'opened': 0, 'clicked': 0, 'bounces': 0, 'complaints': 0}

            for c in campaigns:
                state = c.get('campaignState', 'Pendiente')
                if state in ACTIVE_STATES:
                    active_campaigns += 1
                elif state in PENDING_STATES:
                    pending_campaigns += 1

                channel_name = c.get('channel', '')
                mapped = CHANNEL_MAP.get(channel_name)
                camp_acc = {'sent': 0, 'delivered': 0, 'opened': 0, 'clicked': 0, 'bounces': 0, 'complaints': 0}
                for proc in procs_by_campaign.get(c.get('campaignId'), []):
                    if budget <= 0:
                        truncated = True
                        break
                    pid = proc.get('processId')
                    if not pid:
                        continue
                    budget -= 1
                    counts = _counts_for_process(company, pid)
                    for k in camp_acc:
                        camp_acc[k] += counts[k]

                for k in cust_acc:
                    cust_acc[k] += camp_acc[k]
                if mapped and camp_acc['sent']:
                    key, label = mapped
                    by_channel[key]['sent'] += camp_acc['sent']
                    by_channel[key]['label'] = label

            for k in totals:
                totals[k] += cust_acc[k]

            if cust_acc['sent'] > 0:
                level, reason = _health_level(cust_acc['sent'], cust_acc['bounces'], cust_acc['complaints'])
                health.append({
                    'customerId': customer_id,
                    'company': company,
                    'sent': cust_acc['sent'],
                    'delivered': cust_acc['delivered'],
                    'bounces': cust_acc['bounces'],
                    'complaints': cust_acc['complaints'],
                    'bounceRate': round(cust_acc['bounces'] / cust_acc['sent'], 4),
                    'complaintRate': round(cust_acc['complaints'] / cust_acc['sent'], 4),
                    'level': level,
                    'reason': reason,
                })

        # Riesgo primero (critical > warning > ok), luego por volumen.
        rank = {'critical': 0, 'warning': 1, 'ok': 2}
        health.sort(key=lambda h: (rank.get(h['level'], 3), -h['sent']))

        sent = totals['sent']
        def rate(x):
            return round(x / sent, 4) if sent else 0.0

        kpis = {
            'customers': len(customers),
            'activeCampaigns': active_campaigns,
            'pendingCampaigns': pending_campaigns,
            'totalSent': sent,
            'delivered': totals['delivered'],
            'deliveryRate': rate(totals['delivered']),
            'bounceRate': rate(totals['bounces']),
            'complaintRate': rate(totals['complaints']),
            'atRisk': sum(1 for h in health if h['level'] != 'ok'),
        }
        funnel = [
            {'label': 'Enviados', 'value': totals['sent']},
            {'label': 'Entregados', 'value': totals['delivered']},
            {'label': 'Abiertos', 'value': totals['opened']},
            {'label': 'Clics', 'value': totals['clicked']},
        ]
        by_channel_list = [
            {'channel': k, 'label': v['label'], 'sent': v['sent']}
            for k, v in sorted(by_channel.items(), key=lambda kv: kv[1]['sent'], reverse=True)
        ]

        return {
            'status': True, 'statusCode': 200,
            'description': 'Panel de control global' + (' (parcial)' if truncated else ''),
            'data': {
                'month': month,
                'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
                'kpis': kpis,
                'funnel': funnel,
                'byChannel': by_channel_list,
                'health': health,
                'truncated': truncated,
            }
        }
    except Exception as e:
        print('Error en dashboard admin: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al calcular el panel', 'data': {}}
