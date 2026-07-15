'''
Lambda ADMIN: RESUMEN DE FACTURACIÓN / CONSUMO por cliente y canal.

Convierte los envíos reales (tablas {customer}_sendStatus) en un valor a facturar,
aplicando la tabla de tarifas `pricingRate` (misma que el estimador). Es un resumen
operativo, no una factura fiscal.

Ruta: POST /Billing/Summary  (integración no-proxy, envelope estándar)
Request:  { month?, customerId? }
    - month      : 'YYYY-MM' para acotar por fecha de la campaña. Vacío = todo.
    - customerId : acota a un cliente. Vacío = todos los clientes.
Respuesta: 200 { data: { currency, month, customers:[{customerId, company,
                          companyTin, totalSent, subtotal, tax, total,
                          byChannel:[{channel, label, sent, unitCost, amount}]}],
                          totals:{totalSent, subtotal, tax, total}, truncated, note } }

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.

Cómo se calcula (por campaña, luego se agrega):
  enviados = mensajes con messageId en {customer}_sendStatus del proceso.
  costo    = max(enviados × tarifa_unitaria_del_canal, mínimo_por_campaña).
  El IVA se aplica al subtotal del cliente.
Aproximaciones conocidas: no incluye el recargo por MB del adjunto (no se persiste el
peso); SMS asume 1 segmento; Voz usa los minutos promedio de la tarifa.
'''
import json
import boto3
from decimal import Decimal
from collections import defaultdict
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table_customer = dynamodb.Table('customer')
table_campaign = dynamodb.Table('campaign')
table_process = dynamodb.Table('process')
table_rates = dynamodb.Table('pricingRate')

CURRENCY = 'COP'
MAX_PROCESSES = 500   # tope global de procesos agregados por llamada (evita barridos enormes)

# Debe reflejar DEFAULT_RATES de Api_V1_Cost_Estimate / Api_V1_Pricing_*.
DEFAULT_RATES = {
    'EMAIL': {'baseEM': 8, 'baseEAU': 15, 'baseEAP': 40, 'attachmentPerMB': 5, 'personalizedPdf': 25, 'personalizedDocx': 35},
    'SMS': {'baseSms': 60},
    'WHATSAPP': {'baseMarketing': 90},
    'VOICE': {'basePerMinute': 120, 'avgMinutes': 0.5},
    'COMMON': {'taxRate': 0.19, 'minCampaign': 5000},
}

# channel de la campaña -> (canal de tarifa, etiqueta legible).
CHANNEL_MAP = {
    'EM': ('EMAIL', 'Correo (EM)'),
    'EAU': ('EMAIL', 'Correo adjunto (EAU)'),
    'EAP': ('EMAIL', 'Correo personalizado (EAP)'),
    'SMS': ('SMS', 'SMS'),
    'WSP': ('WHATSAPP', 'WhatsApp'),
    'VOZ': ('VOICE', 'Voz'),
}


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


def _num(value, default=0.0):
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


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


def _load_rate(customer_id, channel):
    """DEFAULT_RATES[channel]+COMMON, sobreescrito por pricingRate ('*' luego cliente)."""
    rate = dict(DEFAULT_RATES.get(channel, {}))
    rate.update(DEFAULT_RATES['COMMON'])
    for cid in ('*', customer_id):
        if not cid:
            continue
        try:
            item = table_rates.get_item(Key={'customerId': cid, 'channel': channel}).get('Item')
        except ClientError as e:
            if e.response['Error']['Code'] == 'ResourceNotFoundException':
                break
            raise
        except Exception:
            continue
        if item:
            for k, v in item.items():
                if k not in ('customerId', 'channel'):
                    rate[k] = _num(v, rate.get(k, 0))
    return rate


def _campaign_unit(rate, channel_name, document_format):
    """Tarifa unitaria por destinatario según el canal de la campaña."""
    if channel_name == 'EM':
        return rate['baseEM']
    if channel_name == 'EAU':
        return rate['baseEAU']
    if channel_name == 'EAP':
        pers = rate['personalizedPdf'] if str(document_format).upper() == 'PDF' else rate['personalizedDocx']
        return rate['baseEAP'] + pers
    if channel_name == 'SMS':
        return rate['baseSms']
    if channel_name == 'WSP':
        return rate['baseMarketing']
    if channel_name == 'VOZ':
        return rate['basePerMinute'] * rate.get('avgMinutes', 0.5)
    return 0.0


def _count_sent(status_table, process_id):
    """Nº de mensajes efectivamente enviados (messageId distinto) en un proceso."""
    seen = set()
    kwargs = {'KeyConditionExpression': Key('processId').eq(process_id),
              'ProjectionExpression': 'messageId'}
    try:
        while True:
            resp = status_table.query(**kwargs)
            for rec in resp.get('Items', []):
                mid = rec.get('messageId')
                if mid:
                    seen.add(mid)
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return 0
        raise
    return len(seen)


def _bill_customer(cust, month, budget):
    """Calcula la facturación de UN cliente. budget = [restante de procesos] (mutable)."""
    customer_id = cust.get('customerId')
    company = cust.get('company', '')
    status_table = dynamodb.Table(f'{company}_sendStatus')

    campaigns = _scan_all(table_campaign, FilterExpression=Attr('customerId').eq(customer_id))
    if month:
        campaigns = [c for c in campaigns if str(c.get('date', '')).startswith(month)]

    processes = _scan_all(table_process, FilterExpression=Attr('customerName').eq(company))
    procs_by_campaign = defaultdict(list)
    for p in processes:
        procs_by_campaign[p.get('campaignId')].append(p)

    by_channel = defaultdict(lambda: {'sent': 0, 'amount': 0.0})
    subtotal = 0.0
    tax_rate = DEFAULT_RATES['COMMON']['taxRate']
    truncated = False

    for c in campaigns:
        channel_name = c.get('channel', '')
        mapped = CHANNEL_MAP.get(channel_name)
        if not mapped:
            continue
        billing_channel, label = mapped
        rate = _load_rate(customer_id, billing_channel)
        tax_rate = rate.get('taxRate', tax_rate)
        unit = _campaign_unit(rate, channel_name, c.get('documentFormat'))

        sent = 0
        for proc in procs_by_campaign.get(c.get('campaignId'), []):
            if budget[0] <= 0:
                truncated = True
                break
            pid = proc.get('processId')
            if not pid:
                continue
            budget[0] -= 1
            sent += _count_sent(status_table, pid)

        if sent <= 0:
            continue
        camp_subtotal = max(sent * unit, rate.get('minCampaign', 0))
        subtotal += camp_subtotal
        agg = by_channel[channel_name]
        agg['sent'] += sent
        agg['amount'] += camp_subtotal
        agg['label'] = label

    def r(x):
        return int(round(x))

    breakdown = []
    total_sent = 0
    for ch, agg in by_channel.items():
        total_sent += agg['sent']
        breakdown.append({
            'channel': ch,
            'label': agg.get('label', ch),
            'sent': agg['sent'],
            'unitCost': r(agg['amount'] / agg['sent']) if agg['sent'] else 0,
            'amount': r(agg['amount']),
        })
    breakdown.sort(key=lambda x: x['amount'], reverse=True)

    tax = subtotal * tax_rate
    return {
        'customerId': customer_id,
        'company': company,
        'companyTin': cust.get('companyTin', ''),
        'totalSent': total_sent,
        'subtotal': r(subtotal),
        'tax': r(tax),
        'total': r(subtotal + tax),
        'byChannel': breakdown,
    }, truncated


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}

    payload = _get_payload(event)
    month = str(payload.get('month', '') or '').strip()
    only_customer = str(payload.get('customerId', '') or '').strip()

    try:
        all_customers = _scan_all(table_customer,
                                  ProjectionExpression='customerId, company, companyTin')
        if only_customer:
            all_customers = [c for c in all_customers if c.get('customerId') == only_customer]

        budget = [MAX_PROCESSES]
        truncated = False
        rows = []
        for cust in all_customers:
            row, tr = _bill_customer(cust, month, budget)
            truncated = truncated or tr
            # Solo incluir clientes con algún envío (evita ruido de clientes sin actividad).
            if row['totalSent'] > 0:
                rows.append(row)

        rows.sort(key=lambda x: x['total'], reverse=True)
        totals = {
            'totalSent': sum(r['totalSent'] for r in rows),
            'subtotal': sum(r['subtotal'] for r in rows),
            'tax': sum(r['tax'] for r in rows),
            'total': sum(r['total'] for r in rows),
        }

        return {
            'status': True, 'statusCode': 200,
            'description': 'Resumen de facturación' + (' (parcial)' if truncated else ''),
            'data': {
                'currency': CURRENCY,
                'month': month,
                'customers': rows,
                'totals': totals,
                'truncated': truncated,
                'note': 'Estimado de consumo basado en envíos reales y tarifas configuradas; '
                        'no incluye recargo por peso de adjunto. No es una factura fiscal.',
            }
        }
    except Exception as e:
        print('Error en facturación: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al calcular la facturación', 'data': {}}
