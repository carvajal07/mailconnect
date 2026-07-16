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

Rendimiento (evita timeouts con muchos clientes):
  Escanea `customer`, `campaign` y `process` UNA sola vez cada una y agrupa en memoria,
  en vez de escanear `campaign` y `process` por cada cliente (antes: 1 + 2·C scans, que
  disparaba timeouts al crecer las tablas). Las tarifas se memoizan por (cliente, canal).
  Cuando SEND_SUMMARY_READ=true, el nº de enviados sale del resumen pre-agregado
  ({customer}_sendSummary, GetItem O(1) por proceso) en vez de paginar {customer}_sendStatus.
'''
import os
import json
import boto3
from decimal import Decimal
from collections import defaultdict
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table_customer = dynamodb.Table('customer')
table_campaign = dynamodb.Table('campaign')
table_process = dynamodb.Table('process')
table_rates = dynamodb.Table('pricingRate')

CURRENCY = 'COP'
MAX_PROCESSES = 500   # tope global de procesos agregados por llamada (evita barridos enormes)

# Lee el resumen pre-agregado ({customer}_sendSummary) para el conteo de enviados (O(1)).
SEND_SUMMARY_READ = os.environ.get('SEND_SUMMARY_READ', '').strip().lower() == 'true'

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


def _count_sent(company, process_id):
    """Nº de mensajes efectivamente enviados (messageId distinto) en un proceso.

    Con SEND_SUMMARY_READ usa el resumen pre-agregado (GetItem O(1)); si no existe,
    cae a paginar {company}_sendStatus (comportamiento legacy).
    """
    if SEND_SUMMARY_READ:
        try:
            summ = dynamodb.Table('{}_sendSummary'.format(company)).get_item(
                Key={'processId': process_id}).get('Item')
            if summ and 'enviados' in summ:
                return int(_num(summ['enviados']))
        except ClientError as e:
            if e.response['Error']['Code'] != 'ResourceNotFoundException':
                raise
        except Exception:
            pass

    seen = set()
    status_table = dynamodb.Table('{}_sendStatus'.format(company))
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


def _bill_customer(cust, camps_by_customer, procs_by_campaign, rate_cache, budget):
    """Factura de UN cliente a partir de las campañas/procesos ya agrupados en memoria.

    - camps_by_customer : {customerId: [campaña,...]} (ya filtrado por mes si aplica).
    - procs_by_campaign : {campaignId: [proceso,...]}.
    - rate_cache        : memoiza _load_rate por (customerId, canal).
    - budget            : [restante de procesos] (mutable) — tope global de queries.
    """
    customer_id = cust.get('customerId')
    company = cust.get('company', '')

    by_channel = defaultdict(lambda: {'sent': 0, 'amount': 0.0})
    subtotal = 0.0
    tax_rate = DEFAULT_RATES['COMMON']['taxRate']
    truncated = False

    for c in camps_by_customer.get(customer_id, []):
        channel_name = c.get('channel', '')
        mapped = CHANNEL_MAP.get(channel_name)
        if not mapped:
            continue
        billing_channel, label = mapped
        cache_key = (customer_id, billing_channel)
        if cache_key not in rate_cache:
            rate_cache[cache_key] = _load_rate(customer_id, billing_channel)
        rate = rate_cache[cache_key]
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
            sent += _count_sent(company, pid)

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
        # 1) UN scan de `customer` (todos), luego se acota en memoria si se pidió uno.
        all_customers = _scan_all(table_customer,
                                  ProjectionExpression='customerId, company, companyTin')
        if only_customer:
            all_customers = [c for c in all_customers if c.get('customerId') == only_customer]

        # 2) UN scan de `campaign` (toda la tabla) agrupado por cliente en memoria.
        #    (Antes se escaneaba por cada cliente -> 1 + 2·C scans -> timeout.)
        campaigns = _scan_all(table_campaign,
                              ProjectionExpression='campaignId, customerId, channel, documentFormat, #d',
                              ExpressionAttributeNames={'#d': 'date'})
        if month:
            campaigns = [c for c in campaigns if str(c.get('date', '')).startswith(month)]
        camps_by_customer = defaultdict(list)
        for c in campaigns:
            camps_by_customer[c.get('customerId')].append(c)

        # 3) UN scan de `process` (toda la tabla) agrupado por campaña en memoria.
        processes = _scan_all(table_process,
                              ProjectionExpression='processId, campaignId')
        procs_by_campaign = defaultdict(list)
        for p in processes:
            procs_by_campaign[p.get('campaignId')].append(p)

        rate_cache = {}
        budget = [MAX_PROCESSES]
        truncated = False
        skipped = 0   # clientes no computados por agotarse el tope (no "sin actividad")
        rows = []
        for cust in all_customers:
            row, tr = _bill_customer(cust, camps_by_customer, procs_by_campaign, rate_cache, budget)
            truncated = truncated or tr
            # Solo incluir clientes con algún envío (evita ruido de clientes sin actividad).
            if row['totalSent'] > 0:
                # 'partial': el tope se agotó mientras se calculaba este cliente, así
                # que su total está SUBESTIMADO (no es la cifra final).
                row['partial'] = tr
                rows.append(row)
            elif tr:
                # totalSent=0 por tope agotado, no por falta de actividad → se omite,
                # pero se cuenta para no reportarlo como $0 silencioso.
                skipped += 1

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
                'skippedCustomers': skipped,
                'note': 'Estimado de consumo basado en envíos reales y tarifas configuradas; '
                        'no incluye recargo por peso de adjunto. No es una factura fiscal.'
                        + (' Resultado PARCIAL: se alcanzó el tope de procesos; '
                           'los clientes con "partial":true están subestimados y '
                           '{} cliente(s) no se computaron.'.format(skipped) if truncated else ''),
            }
        }
    except Exception as e:
        print('Error en facturación: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al calcular la facturación', 'data': {}}
