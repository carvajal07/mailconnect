'''
CASCADA omnicanal — TICK del motor de escalamiento. Ver PLAN_CASCADA.md.

Por cada `cascadeContact` en estado `awaiting` cuya ventana de espera venció, lee el último
estado de entrega en `{tenant}_sendStatus`, lo clasifica (confirmed|failed|pending), y con el
motor puro `decide_next` decide: terminar (done), escalar al siguiente canal (send), agotar
(exhausted) o frenar por saldo (budget). Al escalar, encola el envío del siguiente canal por su
cola SQS y debita su costo del monedero.

Disparo: EventBridge cron (cada ~10–15 min). También acepta POST /Cascade/Advance (manual/test).

⚠️ Integración [J]: las lambdas Send-* deben persistir en `{tenant}_sendStatus` el `uniqueId`
(= cascadeContactId) y el `processId` (= cascadeRunId) que la cascada ya envía en el mensaje.
'''
import os
import json
import uuid
from decimal import Decimal
from datetime import datetime, timedelta

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
sqs = boto3.client('sqs')

table_run = dynamodb.Table('cascadeRun')
table_contact = dynamodb.Table('cascadeContact')
table_balance = dynamodb.Table('customerBalance')
table_wallet = dynamodb.Table('walletTransaction')
table_rates = dynamodb.Table('pricingRate')

# Colas por canal (mismas que Prepare-batch). La cascada v1 admite EM/SMS/WSP/VOZ.
CHANNEL_QUEUE = {
    'EM': os.environ.get('URL_SQS_EM', 'https://sqs.us-east-1.amazonaws.com/873837768806/Email_Send-batch-template-EM'),
    'SMS': os.environ.get('URL_SQS_SMS', 'https://sqs.us-east-1.amazonaws.com/873837768806/Sms_Send-batch'),
    'WSP': os.environ.get('URL_SQS_WSP', 'https://sqs.us-east-1.amazonaws.com/873837768806/Wsp_Send-batch'),
    'VOZ': os.environ.get('URL_SQS_VOICE', 'https://sqs.us-east-1.amazonaws.com/873837768806/Voice_Send-batch'),
}

GSI_RUN_INDEX = os.environ.get('GSI_CASCADE_RUN_INDEX', 'cascadeRunId-index')

# --- Estados de entrega (alineado con Reports_Statistics.STATE_PRIORITY) --------------------
# 1 enviado · 2 entregado · 3 rechazado/fallido · 4 abierto/leído · 5 clic · 11 contacto inválido
STATE_PRIORITY = {1: 1, 9: 2, 8: 3, 3: 4, 2: 5, 6: 6, 10: 7, 7: 8, 4: 9, 5: 10}
HARD_FAIL = {3, 11}
DELIVERED_STATES = {2, 4, 5}
READ_STATES = {4, 5}


# ============================ MOTOR (funciones PURAS, probadas) ============================
def classify_outcome(state, criterion):
    """Clasifica el resultado de un contacto según el estado de entrega y el criterio de éxito.
    `state`: int (estado de sendStatus) o None (sin registro aún). Devuelve 'confirmed'|'failed'
    |'pending'. Conservador: un estado desconocido es 'pending' (la ventana igual hace avanzar)."""
    if state is None:
        return 'pending'
    s = int(state)
    if s in HARD_FAIL:
        return 'failed'
    if criterion == 'sent':
        return 'confirmed' if s >= 1 else 'pending'
    if criterion == 'delivered':
        return 'confirmed' if s in DELIVERED_STATES else 'pending'
    if criterion == 'read':
        return 'confirmed' if s in READ_STATES else 'pending'
    return 'pending'


def decide_next(steps, step_index, outcome, elapsed_min, wait_min, remaining_budget, cost_of, consent_of):
    """Decide la próxima acción para UN contacto (función pura — ver PLAN_CASCADA §2).

    Args:
        steps: lista de pasos [{channel, ...}].
        step_index: índice del paso actual (0-based).
        outcome: 'confirmed' | 'failed' | 'pending'.
        elapsed_min: minutos desde el último envío.
        wait_min: ventana de espera antes de escalar.
        remaining_budget: saldo/tope disponible (COP).
        cost_of(channel) -> costo (COP) de enviar a este contacto por ese canal.
        consent_of(channel) -> bool: ¿hay consentimiento para ese canal?

    Returns dict: {'action': 'done'|'wait'|'exhausted'|'budget'|'send', 'stepIndex'?, 'channel'?, 'cost'?}
    """
    if outcome == 'confirmed':
        return {'action': 'done'}
    if outcome == 'pending' and elapsed_min < wait_min:
        return {'action': 'wait'}
    # outcome == 'failed', o 'pending' pero venció la ventana -> intentar escalar.
    nxt = step_index + 1
    while nxt < len(steps):
        channel = steps[nxt]['channel']
        if not consent_of(channel):
            nxt += 1
            continue
        cost = cost_of(channel)
        if remaining_budget < cost:
            return {'action': 'budget', 'needed': cost}
        return {'action': 'send', 'stepIndex': nxt, 'channel': channel, 'cost': cost}
    return {'action': 'exhausted'}


# ============================ Costo (réplica compacta de Cost_Estimate) ====================
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
    """Override plano de pricingRate ('*' global, luego el del cliente). None si no hay."""
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
    """Costo TOTAL (COP entero, con IVA y mínimo) de enviar `recipients` por ese canal.
    Misma lógica/tarifas que Cost_Estimate/Prepare-batch (tramo por volumen + override)."""
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


def unit_cost(customer_id, channel):
    """Costo de UN envío por el canal (para el motor: escalar un contacto). Sin mínimo de
    campaña (el mínimo aplica al lote, no al contacto individual)."""
    m = CH_TIER.get(channel)
    if not m:
        return 0
    override_key, tier_key, rate_channel = m
    unit = _rate_override(customer_id, rate_channel, override_key)
    if unit is None:
        unit = _tier_unit(tier_key, 1)
    if channel == 'VOZ':
        unit = unit * AVG_VOICE_MIN
    return int(round(unit * (1 + DEFAULT_TAX_RATE)))


# ============================ Monedero (débito atómico) ====================================
def debit(customer_id, amount, reference, detail):
    """Debita `amount` (COP) del saldo con condición balance>=amount (bloqueo duro). Registra
    en walletTransaction. Devuelve True si debitó, False si saldo insuficiente. Fail-open: si la
    tabla de saldo no existe (rollout), no cobra y devuelve True (no bloquea la cascada)."""
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
            return False  # saldo insuficiente (o cuenta sin saldo)
        if code == 'ResourceNotFoundException':
            return True   # tabla no provisionada: rollout sin cobro
        raise
    try:
        table_wallet.put_item(Item={
            'txId': str(uuid.uuid4()), 'customerId': customer_id, 'type': 'debit_send',
            'amount': Decimal(str(-amount)), 'balanceAfter': Decimal(str(balance_after)),
            'status': 'approved', 'reference': reference, 'detail': detail,
            'createdAt': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')})
    except Exception as e:
        print('No se pudo registrar el movimiento del monedero: {}'.format(e))
    return True


# ============================ Lecturas de estado / consentimiento ==========================
def tenant_key(nit):
    import re
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def read_contact_state(tenant, process_id, unique_id):
    """Último estado (el de mayor prioridad) del contacto en `{tenant}_sendStatus`, filtrando por
    `uniqueId`. None si no hay registro todavía. Ver contrato de correlación en PLAN_CASCADA §6."""
    table = dynamodb.Table('{}_sendStatus'.format(tenant))
    try:
        best_state, best_pri = None, -1
        kwargs = {'KeyConditionExpression': Key('processId').eq(process_id)}
        while True:
            resp = table.query(**kwargs)
            for it in resp.get('Items', []):
                if str(it.get('uniqueId', '')) != str(unique_id):
                    continue
                st = int(_num(it.get('state'), 0))
                pri = STATE_PRIORITY.get(st, 0)
                if pri >= best_pri:
                    best_pri, best_state = pri, st
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last
        return best_state
    except Exception as e:
        print('No se pudo leer sendStatus ({}): {}'.format(tenant, e))
        return None


def has_consent(tenant, channel, contact_value):
    """¿El contacto NO está en lista negra ni desuscrito para ese canal? (mismas tablas por
    cliente que el envío real). Fail-open: si no se puede leer, asume consentimiento."""
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


# ============================ Envío por canal (encola en la cola del canal) ================
def contact_value_for(channel, row):
    """El valor de contacto (col. 2 del CSV). En cascada v1 la base trae UN contacto (correo
    para EM; celular para SMS/WSP/VOZ). El mapeo por canal (columnas separadas) es Fase 2."""
    return (row[1] if len(row) > 1 else '') or ''


def enqueue_send(run, contact, channel, content):
    """Encola el envío de UN contacto por la cola del canal, con el formato que consumen las
    lambdas Send-* + los campos de correlación de la cascada (processId, uniqueId, cascade*)."""
    msg = {
        'customerId': run['customerId'],
        'customerName': run.get('customer', ''),
        'nit': run.get('nit', ''),
        'processId': run['cascadeRunId'],       # correlación: processId = cascadeRunId
        'uniqueId': contact['cascadeContactId'],  # correlación: uniqueId = cascadeContactId
        'cascadeRunId': run['cascadeRunId'],
        'cascadeContactId': contact['cascadeContactId'],
        'channel': channel,
        'templateName': content if channel == 'EM' else '',
        'smsBody': content if channel == 'SMS' else '',
        'wspTemplate': content if channel == 'WSP' else '',
        'voiceMessage': content if channel == 'VOZ' else '',
        'data': [contact['row']],
        'samples': False,
    }
    sqs.send_message(QueueUrl=CHANNEL_QUEUE[channel], MessageBody=json.dumps(msg))


# ============================ Tick del motor ===============================================
def _due_contacts(run_id, now_iso):
    """Contactos `awaiting` del run cuya ventana venció (nextCheckAt <= now). Query por GSI."""
    items = []
    kwargs = {'IndexName': GSI_RUN_INDEX, 'KeyConditionExpression': Key('cascadeRunId').eq(run_id)}
    while True:
        resp = table_contact.query(**kwargs)
        for it in resp.get('Items', []):
            if it.get('status') == 'awaiting' and str(it.get('nextCheckAt', '')) <= now_iso:
                items.append(it)
        last = resp.get('LastEvaluatedKey')
        if not last:
            break
        kwargs['ExclusiveStartKey'] = last
    return items


def _running_runs():
    resp = table_run.scan(FilterExpression='#s = :r',
                          ExpressionAttributeNames={'#s': 'status'},
                          ExpressionAttributeValues={':r': 'running'})
    return resp.get('Items', [])


def advance_run(run, now):
    """Avanza un run: por cada contacto vencido decide y actúa. Devuelve un resumen de conteos."""
    now_iso = now.strftime('%Y-%m-%d %H:%M:%S')
    tenant = tenant_key(run.get('nit'))
    steps = run.get('steps') or []
    # Defaults del run; cada paso puede sobreescribir waitMinutes y successCriterion (flujo de
    # decisión por nodo). La espera aplica al paso en que está el contacto AHORA; el criterio
    # define qué cuenta como confirmado en ese paso.
    run_wait = int(_num(run.get('waitMinutes'), 60))
    run_criterion = run.get('successCriterion', 'delivered')
    customer_id = run['customerId']
    summary = {'confirmed': 0, 'escalated': 0, 'exhausted': 0, 'budget': 0, 'waiting': 0}

    for c in _due_contacts(run['cascadeRunId'], now_iso):
        step_index = int(_num(c.get('stepIndex'), 0))
        cur = steps[step_index] if 0 <= step_index < len(steps) else {}
        step_wait = int(_num(cur.get('waitMinutes'), run_wait)) or run_wait
        step_criterion = cur.get('successCriterion') or run_criterion
        state = read_contact_state(tenant, run['cascadeRunId'], c['cascadeContactId'])
        outcome = classify_outcome(state, step_criterion)
        last_sent = c.get('lastSentAt') or now_iso
        try:
            elapsed = (now - datetime.strptime(last_sent, '%Y-%m-%d %H:%M:%S')).total_seconds() / 60.0
        except Exception:
            elapsed = step_wait  # si no se puede parsear, trata como vencido

        def cost_of(ch):
            return unit_cost(customer_id, ch)

        def consent_of(ch):
            return has_consent(tenant, ch, contact_value_for(ch, c.get('row') or []))

        remaining = 10 ** 12  # el tope real lo impone el débito atómico del monedero
        decision = decide_next(steps, step_index, outcome, elapsed, step_wait, remaining, cost_of, consent_of)
        act = decision['action']

        if act == 'wait':
            summary['waiting'] += 1
            continue
        if act == 'done':
            _finish_contact(c, 'confirmed')
            summary['confirmed'] += 1
            continue
        if act == 'exhausted':
            _finish_contact(c, 'exhausted')
            summary['exhausted'] += 1
            continue
        if act == 'send':
            nxt = decision['stepIndex']
            channel = decision['channel']
            content = steps[nxt].get('content', '')
            if not debit(customer_id, decision['cost'], run['cascadeRunId'],
                         'Cascada {} · escala a {}'.format(run.get('name', ''), channel)):
                _finish_contact(c, 'budget')
                summary['budget'] += 1
                continue
            enqueue_send(run, c, channel, content)
            # La próxima revisión usa la espera del paso al que se escala (por-nodo o del run).
            next_wait = int(_num(steps[nxt].get('waitMinutes'), run_wait)) or run_wait
            next_check_iso = (now + timedelta(minutes=max(1, next_wait))).strftime('%Y-%m-%d %H:%M:%S')
            _escalate_contact(c, nxt, channel, now_iso, next_check_iso)
            summary['escalated'] += 1

    return summary


def _finish_contact(c, status):
    table_contact.update_item(
        Key={'cascadeContactId': c['cascadeContactId']},
        UpdateExpression='SET #s = :s',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':s': status})


def _escalate_contact(c, step_index, channel, now_iso, next_check_iso):
    unique_id = c['cascadeContactId']
    history = c.get('history') or []
    history.append({'channel': channel, 'sentAt': now_iso, 'uniqueId': unique_id})
    table_contact.update_item(
        Key={'cascadeContactId': unique_id},
        UpdateExpression=('SET stepIndex = :i, lastChannel = :ch, lastSentAt = :t, '
                          'nextCheckAt = :n, #h = :h'),
        ExpressionAttributeNames={'#h': 'history'},
        ExpressionAttributeValues={
            ':i': step_index, ':ch': channel, ':t': now_iso,
            ':n': next_check_iso, ':h': history})


def lambda_handler(event, context):
    now = datetime.utcnow()
    runs = _running_runs()
    totals = {'runs': 0, 'confirmed': 0, 'escalated': 0, 'exhausted': 0, 'budget': 0, 'waiting': 0}
    for run in runs:
        s = advance_run(run, now)
        totals['runs'] += 1
        for k in ('confirmed', 'escalated', 'exhausted', 'budget', 'waiting'):
            totals[k] += s[k]
        _refresh_run_counts(run)
    print('Cascade advance: {}'.format(totals))
    return {'status': True, 'statusCode': 200, 'description': 'Cascada avanzada', 'data': totals}


def _refresh_run_counts(run):
    """Recalcula conteos del run y lo cierra si ya no quedan contactos `awaiting`."""
    items = []
    kwargs = {'IndexName': GSI_RUN_INDEX, 'KeyConditionExpression': Key('cascadeRunId').eq(run['cascadeRunId'])}
    while True:
        resp = table_contact.query(**kwargs)
        items.extend(resp.get('Items', []))
        last = resp.get('LastEvaluatedKey')
        if not last:
            break
        kwargs['ExclusiveStartKey'] = last
    counts = {'total': len(items), 'confirmed': 0, 'exhausted': 0, 'inFlight': 0, 'budget': 0}
    for it in items:
        st = it.get('status')
        if st == 'confirmed':
            counts['confirmed'] += 1
        elif st == 'exhausted':
            counts['exhausted'] += 1
        elif st == 'budget':
            counts['budget'] += 1
        elif st == 'awaiting':
            counts['inFlight'] += 1
    run_status = 'running' if counts['inFlight'] > 0 else 'done'
    table_run.update_item(
        Key={'cascadeRunId': run['cascadeRunId']},
        UpdateExpression='SET #c = :c, #s = :st',
        ExpressionAttributeNames={'#c': 'counts', '#s': 'status'},
        ExpressionAttributeValues={':c': counts, ':st': run_status})
