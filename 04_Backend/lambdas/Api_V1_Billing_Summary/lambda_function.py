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
import re
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


def tenant_key(nit):
    """Llave de tenant (NIT saneado) para las tablas de estados por cliente
    ({tenant}_sendStatus, _sendSummary). Igual que en Prepare-batch/buckets. Idempotente."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())

CURRENCY = 'COP'
MAX_PROCESSES = 500   # tope global de procesos agregados por llamada (evita barridos enormes)

# Lee SIEMPRE (por defecto) el resumen pre-agregado ({customer}_sendSummary) para el conteo
# de enviados (O(1)); si un proceso no tiene resumen, cae al conteo por Query de ESE proceso.

# Debe reflejar DEFAULT_RATES de Api_V1_Cost_Estimate / Api_V1_Pricing_*.
DEFAULT_RATES = {
    'EMAIL': {'baseEM': None, 'baseEAU': None, 'baseEAP': None, 'attachmentPerMB': 0, 'personalizedPdf': 0, 'personalizedDocx': 0},
    'SMS': {'baseSms': None},
    'WHATSAPP': {'baseMarketing': None},
    'VOICE': {'basePerMinute': None, 'avgMinutes': 0.5},
    'COMMON': {'taxRate': 0.19, 'minCampaign': 5000},
}
# Precio unitario por TRAMO de volumen (COP). Réplica de Api_V1_Cost_Estimate.VOLUME_TIERS
# (mantener en sync). El tramo se elige por el total de envíos y es "todo incluido".
VOLUME_TIERS = {
    'EM':       [(1, 30), (2000, 28), (5000, 27), (10000, 25), (20000, 21), (50000, 19), (100000, 14), (200000, 9), (500000, 5), (1000000, 4)],
    'EAU':      [(1, 45), (2000, 42), (5000, 40), (10000, 37), (20000, 31), (50000, 28), (100000, 21), (200000, 14), (500000, 8), (1000000, 6)],
    'EAP':      [(1, 60), (2000, 55), (5000, 50), (10000, 46), (20000, 38), (50000, 33), (100000, 24), (200000, 16), (500000, 10), (1000000, 8)],
    'SMS':      [(1, 55), (2000, 50), (5000, 45), (10000, 40), (20000, 35), (50000, 28), (100000, 22), (200000, 18), (500000, 14), (1000000, 10)],
    'WHATSAPP': [(1, 130), (2000, 125), (5000, 118), (10000, 110), (20000, 100), (50000, 90), (100000, 82), (200000, 76), (500000, 70), (1000000, 65)],
    'VOICE':    [(1, 150), (2000, 140), (5000, 130), (10000, 120), (20000, 110), (50000, 95), (100000, 80), (200000, 70), (500000, 60), (1000000, 48)],
}
CAMPAIGN_TIER = {
    'EM': ('baseEM', 'EM'), 'EAU': ('baseEAU', 'EAU'), 'EAP': ('baseEAP', 'EAP'),
    'SMS': ('baseSms', 'SMS'), 'WSP': ('baseMarketing', 'WHATSAPP'), 'VOZ': ('basePerMinute', 'VOICE'),
}
ONLINE_FACTOR = 1.0   # hook ONLINE (enlace) vs ONFILE (adjunto); hoy mismo precio

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


def _is_sample_process(p):
    """¿Es un proceso de MUESTRAS (envío de prueba)? Las muestras NO se facturan (el monedero
    prepago tampoco las cobra; por eso están limitadas por campaña). Se excluyen del consumo.
    Señal explícita `isSamples`; fallback por processState/nombre para procesos viejos."""
    if p.get('isSamples'):
        return True
    if str(p.get('processState', '')) == 'Muestras':
        return True
    return str(p.get('campaignName', '')).endswith('-Samples')


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


def _tier_unit(tier_key, recipients):
    """Precio unitario del TRAMO por volumen. Réplica de Api_V1_Cost_Estimate._tier_unit."""
    tiers = VOLUME_TIERS.get(tier_key) or []
    if not tiers:
        return 0
    unit = tiers[0][1]
    for min_qty, price in tiers:
        if recipients >= min_qty:
            unit = price
        else:
            break
    return unit


def _base_unit(rate, override_key, tier_key, recipients):
    """Base del canal: override plano de pricingRate si existe; si no, el tramo por volumen."""
    v = rate.get(override_key)
    if v is not None:
        return _num(v)
    return _tier_unit(tier_key, recipients)


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


def _campaign_unit(rate, channel_name, recipients, document_format=None, delivery='ONFILE'):
    """Tarifa unitaria por destinatario, ESCALONADA por volumen (tramo por `recipients`).
    Réplica de Api_V1_Cost_Estimate (mantener en sync). Un override plano de pricingRate gana
    sobre el tramo. ONLINE vs ONFILE: hook de precio en EAU/EAP (hoy factor 1.0)."""
    mapping = CAMPAIGN_TIER.get(channel_name)
    if not mapping:
        return 0.0
    override_key, tier_key = mapping
    unit = _base_unit(rate, override_key, tier_key, recipients)
    if channel_name == 'VOZ':
        unit = unit * rate.get('avgMinutes', 0.5)
    if channel_name in ('EAU', 'EAP') and str(delivery).upper() == 'ONLINE' and ONLINE_FACTOR != 1.0:
        unit = unit * ONLINE_FACTOR
    return unit


def _count_sent(tenant, process_id):
    """Nº de mensajes efectivamente enviados (messageId distinto) en un proceso.
    tenant=tenant_key(NIT): las tablas del cliente son {tenant}_sendSummary / _sendStatus.

    Con SEND_SUMMARY_READ usa el resumen pre-agregado (GetItem O(1)); si no existe,
    cae a paginar {tenant}_sendStatus (comportamiento legacy).
    """
    # 1) Resumen pre-agregado (O(1)) — por defecto.
    try:
        summ = dynamodb.Table('{}_sendSummary'.format(tenant)).get_item(
            Key={'processId': process_id}).get('Item')
        if summ and 'enviados' in summ:
            return int(_num(summ['enviados']))
    except ClientError as e:
        if e.response['Error']['Code'] != 'ResourceNotFoundException':
            raise
    except Exception:
        pass
    # 2) Fallback: conteo por Query de los estados de ESE proceso.

    seen = set()
    status_table = dynamodb.Table('{}_sendStatus'.format(tenant))
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
    # Llave de las tablas de estados por cliente (NIT saneado), igual que en el resto.
    tenant = tenant_key(cust.get('companyTin', ''))

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

        sent = 0
        for proc in procs_by_campaign.get(c.get('campaignId'), []):
            if budget[0] <= 0:
                truncated = True
                break
            pid = proc.get('processId')
            if not pid:
                continue
            budget[0] -= 1
            sent += _count_sent(tenant, pid)

        if sent <= 0:
            continue
        # Unitario ESCALONADO por volumen: usa `sent` (envíos reales) como recipients del
        # tramo. Modo de entrega (ONFILE/ONLINE) desde la campaña (hook de precio).
        unit = _campaign_unit(rate, channel_name, sent, c.get('documentFormat'), c.get('attachmentType') or 'ONFILE')
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
                              ProjectionExpression='campaignId, customerId, channel, documentFormat, attachmentType, #d',
                              ExpressionAttributeNames={'#d': 'date'})
        if month:
            campaigns = [c for c in campaigns if str(c.get('date', '')).startswith(month)]
        camps_by_customer = defaultdict(list)
        for c in campaigns:
            camps_by_customer[c.get('customerId')].append(c)

        # 3) UN scan de `process` (toda la tabla) agrupado por campaña en memoria. Se
        #    EXCLUYEN los procesos de muestra: las pruebas no se facturan (igual que el monedero).
        processes = _scan_all(table_process,
                              ProjectionExpression='processId, campaignId, processState, campaignName, isSamples')
        procs_by_campaign = defaultdict(list)
        for p in processes:
            if _is_sample_process(p):
                continue
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
