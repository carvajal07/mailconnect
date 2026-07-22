'''
CASCADA omnicanal — LANZAMIENTO. Ver PLAN_CASCADA.md.

POST /Cascade/Dispatch (no-proxy, envelope). Request:
  { name, dataPath, waitMinutes?, successCriterion? ('sent'|'delivered'|'read'),
    steps: [{ channel: EM|SMS|WSP|VOZ, content }] }  (contenido listo para enviar por canal)

Crea el `cascadeRun` + un `cascadeContact` por contacto (paso 0, `awaiting`), filtra
consentimiento del canal del paso 0, ENCOLA el envío del paso 0 (una cola por canal, formato
Send-*) con `uniqueId = cascadeContactId`, y DEBITA el costo del paso 0 del monedero.
El escalamiento posterior lo maneja Api_V1_Cascade_Advance (tick).

Respuesta: 201 { data:{ cascadeRunId, contacts, debited } } · 400 datos · 402 saldo · 403 tenant.
'''
import os
import re
import csv
import json
import uuid
import io
from decimal import Decimal
from datetime import datetime, timedelta

import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
s3 = boto3.client('s3')
sqs = boto3.client('sqs')

table_run = dynamodb.Table('cascadeRun')
table_contact = dynamodb.Table('cascadeContact')
table_balance = dynamodb.Table('customerBalance')
table_wallet = dynamodb.Table('walletTransaction')
table_rates = dynamodb.Table('pricingRate')

BUCKET_PREFIX = os.environ.get('BUCKET_PREFIX', 'mailconnect')
ALLOWED_CHANNELS = ('EM', 'SMS', 'WSP', 'VOZ')
MAX_CONTACTS = int(os.environ.get('CASCADE_MAX_CONTACTS', '5000'))  # v1: sin troceo (Fase 2)

CHANNEL_QUEUE = {
    'EM': os.environ.get('URL_SQS_EM', 'https://sqs.us-east-1.amazonaws.com/873837768806/Email_Send-batch-template-EM'),
    'SMS': os.environ.get('URL_SQS_SMS', 'https://sqs.us-east-1.amazonaws.com/873837768806/Sms_Send-batch'),
    'WSP': os.environ.get('URL_SQS_WSP', 'https://sqs.us-east-1.amazonaws.com/873837768806/Wsp_Send-batch'),
    'VOZ': os.environ.get('URL_SQS_VOICE', 'https://sqs.us-east-1.amazonaws.com/873837768806/Voice_Send-batch'),
}

# --- Costo (réplica compacta; en sync con Cost_Estimate/Prepare-batch/Cascade_Advance) -----
DEFAULT_TAX_RATE = 0.19
DEFAULT_MIN = 5000
VOLUME_TIERS = {
    'EM': [(1, 30), (2000, 28), (5000, 27), (10000, 25), (20000, 21), (50000, 19), (100000, 14), (200000, 9), (500000, 5), (1000000, 4)],
    'SMS': [(1, 55), (2000, 50), (5000, 45), (10000, 40), (20000, 35), (50000, 28), (100000, 22), (200000, 18), (500000, 14), (1000000, 10)],
    'WHATSAPP': [(1, 130), (2000, 125), (5000, 118), (10000, 110), (20000, 100), (50000, 90), (100000, 82), (200000, 76), (500000, 70), (1000000, 65)],
    'VOICE': [(1, 150), (2000, 140), (5000, 130), (10000, 120), (20000, 110), (50000, 95), (100000, 80), (200000, 70), (500000, 60), (1000000, 48)],
}
CH_TIER = {'EM': ('baseEM', 'EM', 'EMAIL'), 'SMS': ('baseSms', 'SMS', 'SMS'),
           'WSP': ('baseMarketing', 'WHATSAPP', 'WHATSAPP'), 'VOZ': ('basePerMinute', 'VOICE', 'VOICE')}
AVG_VOICE_MIN = 0.5


def _num(v, d=0.0):
    if isinstance(v, Decimal):
        return float(v)
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def _tier_unit(tier_key, recipients):
    tiers = VOLUME_TIERS.get(tier_key) or []
    unit = tiers[0][1] if tiers else 0
    for min_qty, price in tiers:
        if recipients >= min_qty:
            unit = price
        else:
            break
    return unit


def _rate_override(customer_id, rate_channel, override_key):
    val = None
    for cid in ('*', customer_id):
        if not cid:
            continue
        try:
            item = table_rates.get_item(Key={'customerId': cid, 'channel': rate_channel}).get('Item')
        except Exception:
            item = None
        if item and item.get(override_key) is not None:
            val = _num(item.get(override_key))
    return val


def channel_cost(customer_id, channel, recipients):
    m = CH_TIER.get(channel)
    if not m or recipients <= 0:
        return 0
    override_key, tier_key, rate_channel = m
    unit = _rate_override(customer_id, rate_channel, override_key)
    if unit is None:
        unit = _tier_unit(tier_key, recipients)
    if channel == 'VOZ':
        unit = unit * AVG_VOICE_MIN
    subtotal = max(unit * recipients, DEFAULT_MIN)
    return int(round(subtotal * (1 + DEFAULT_TAX_RATE)))


def debit(customer_id, amount, reference, detail):
    """Débito atómico (balance>=amount). True=debitó, False=saldo insuficiente. Fail-open si la
    tabla no existe (rollout)."""
    if amount <= 0:
        return True
    try:
        resp = table_balance.update_item(
            Key={'customerId': customer_id},
            UpdateExpression='SET balance = if_not_exists(balance, :z) - :a',
            ConditionExpression='attribute_exists(customerId) AND balance >= :a',
            ExpressionAttributeValues={':a': Decimal(str(amount)), ':z': Decimal('0')},
            ReturnValues='UPDATED_NEW')
        balance_after = int(resp['Attributes']['balance'])
    except ClientError as e:
        code = e.response['Error']['Code']
        if code == 'ConditionalCheckFailedException':
            return False
        if code == 'ResourceNotFoundException':
            return True
        raise
    try:
        table_wallet.put_item(Item={
            'txId': str(uuid.uuid4()), 'customerId': customer_id, 'type': 'debit_send',
            'amount': Decimal(str(-amount)), 'balanceAfter': Decimal(str(balance_after)),
            'status': 'approved', 'reference': reference, 'detail': detail,
            'createdAt': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')})
    except Exception as e:
        print('No se pudo registrar el movimiento: {}'.format(e))
    return True


def tenant_key(nit):
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def has_consent(tenant, contact_value):
    key = str(contact_value or '').strip().lower()
    if not key:
        return False
    for suffix in ('_blackList', '_unsubscribe'):
        try:
            t = dynamodb.Table('{}{}'.format(tenant, suffix))
            if t.get_item(Key={'email': key}).get('Item'):
                return False
        except Exception:
            continue
    return True


def enqueue_send(run, contact, channel, content):
    msg = {
        'customerId': run['customerId'], 'customerName': run.get('customer', ''), 'nit': run.get('nit', ''),
        'processId': run['cascadeRunId'], 'uniqueId': contact['cascadeContactId'],
        'cascadeRunId': run['cascadeRunId'], 'cascadeContactId': contact['cascadeContactId'],
        'channel': channel,
        'templateName': content if channel == 'EM' else '',
        'smsBody': content if channel == 'SMS' else '',
        'wspTemplate': content if channel == 'WSP' else '',
        'voiceMessage': content if channel == 'VOZ' else '',
        'data': [contact['row']], 'samples': False,
    }
    sqs.send_message(QueueUrl=CHANNEL_QUEUE[channel], MessageBody=json.dumps(msg))


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _tenant(event):
    auth = (event.get('requestContext') or {}).get('authorizer') or {} if isinstance(event, dict) else {}
    return auth.get('customerId'), auth.get('customer'), auth.get('nit')


def _detect_delimiter(header_line):
    best, best_count = ';', -1
    for d in (';', ',', '\t', '|'):
        c = header_line.count(d)
        if c > best_count:
            best_count, best = c, d
    return best


def _read_base(nit, data_path):
    """Baja el CSV de la base del bucket del cliente y devuelve las filas de datos (sin encabezado)."""
    bucket = '{}-{}'.format(BUCKET_PREFIX, tenant_key(nit))
    obj = s3.get_object(Bucket=bucket, Key=data_path)
    text = obj['Body'].read().decode('utf-8', errors='replace').replace('﻿', '')
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []
    delim = _detect_delimiter(lines[0])
    reader = list(csv.reader(io.StringIO('\n'.join(lines)), delimiter=delim))
    return reader[1:]  # sin encabezado


def lambda_handler(event, context):
    payload = _get_payload(event)
    customer_id, customer, nit = _tenant(event)
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.'}
    if not nit:
        return {'status': False, 'statusCode': 400, 'description': 'El cliente no tiene NIT (llave de recursos).'}

    name = str(payload.get('name', '') or '').strip() or 'Cascada'
    data_path = str(payload.get('dataPath', '') or '').strip()
    wait_minutes = int(_num(payload.get('waitMinutes'), 60))
    criterion = str(payload.get('successCriterion', 'delivered') or 'delivered')
    steps = payload.get('steps') or []

    if criterion not in ('sent', 'delivered', 'read'):
        return {'status': False, 'statusCode': 400, 'description': 'successCriterion inválido.'}
    if not data_path:
        return {'status': False, 'statusCode': 400, 'description': 'Falta la base (dataPath).'}
    if not isinstance(steps, list) or len(steps) < 2:
        return {'status': False, 'statusCode': 400, 'description': 'La cascada necesita al menos 2 canales en orden.'}
    for st in steps:
        if not isinstance(st, dict) or st.get('channel') not in ALLOWED_CHANNELS or not str(st.get('content', '')).strip():
            return {'status': False, 'statusCode': 400,
                    'description': 'Cada paso necesita channel (EM/SMS/WSP/VOZ) y content. EAU/EAP no aplican en cascada v1.'}

    try:
        rows = _read_base(nit, data_path)
    except Exception as e:
        print('No se pudo leer la base: {}'.format(e))
        return {'status': False, 'statusCode': 400, 'description': 'No se pudo leer la base de datos indicada.'}
    if not rows:
        return {'status': False, 'statusCode': 400, 'description': 'La base no tiene contactos.'}
    if len(rows) > MAX_CONTACTS:
        return {'status': False, 'statusCode': 400,
                'description': 'La base supera el máximo de {} contactos para cascada (v1).'.format(MAX_CONTACTS)}

    tenant = tenant_key(nit)
    step0 = steps[0]
    ch0, content0 = step0['channel'], step0['content']

    # Filtrar consentimiento del canal del paso 0 (col. 2 = contacto).
    eligible = []
    for r in rows:
        contact_val = (r[1] if len(r) > 1 else '') or ''
        if has_consent(tenant, contact_val):
            eligible.append(r)
    if not eligible:
        return {'status': False, 'statusCode': 400, 'description': 'Ningún contacto tiene consentimiento para el primer canal.'}

    # Débito del paso 0 (todos los elegibles por el canal 0). Bloqueo duro por saldo.
    cost0 = channel_cost(customer_id, ch0, len(eligible))
    run_id = str(uuid.uuid4())
    if not debit(customer_id, cost0, run_id, 'Cascada "{}" · paso 1 ({})'.format(name, ch0)):
        return {'status': False, 'statusCode': 402,
                'description': 'Saldo insuficiente para el primer canal de la cascada.',
                'data': {'needed': cost0}}

    now = datetime.utcnow()
    now_iso = now.strftime('%Y-%m-%d %H:%M:%S')
    next_check = (now + timedelta(minutes=wait_minutes)).strftime('%Y-%m-%d %H:%M:%S')

    table_run.put_item(Item={
        'cascadeRunId': run_id, 'customerId': customer_id, 'customer': customer or '', 'nit': str(nit),
        'name': name, 'steps': steps, 'successCriterion': criterion, 'waitMinutes': wait_minutes,
        'dataPath': data_path, 'status': 'running', 'spent': Decimal(str(cost0)),
        'counts': {'total': len(eligible), 'confirmed': 0, 'exhausted': 0, 'inFlight': len(eligible), 'budget': 0},
        'createdAt': now_iso,
    })

    for r in eligible:
        contact_id = str(uuid.uuid4())
        item = {
            'cascadeContactId': contact_id, 'cascadeRunId': run_id, 'customerId': customer_id,
            'contactKey': (r[1] if len(r) > 1 else ''), 'row': r, 'stepIndex': 0, 'status': 'awaiting',
            'lastChannel': ch0, 'lastSentAt': now_iso, 'nextCheckAt': next_check,
            'history': [{'channel': ch0, 'sentAt': now_iso, 'uniqueId': contact_id}],
        }
        table_contact.put_item(Item=item)
        enqueue_send({'cascadeRunId': run_id, 'customerId': customer_id, 'customer': customer, 'nit': str(nit)},
                     item, ch0, content0)

    return {'status': True, 'statusCode': 201, 'description': 'Cascada lanzada',
            'data': {'cascadeRunId': run_id, 'contacts': len(eligible), 'debited': cost0}}
