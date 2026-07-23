'''
Cascada omnicanal — MOTOR (Tick). Sin ruta de API: lo dispara EventBridge (cron cada
~5 min) y/o `Cascade_Start` (invoke con {cascadeRunId} para un arranque inmediato).

Por cada run `running` recorre sus contactos accionables y aplica UNA transición:
  - pending  → resuelve el canal del paso (salta canales sin dirección/consentimiento),
               verifica presupuesto, reserva saldo, encola 1 fila al queue del canal y
               pasa a `awaiting` con nextEscalationAt = ahora + timeout.
  - awaiting → lee el resultado del último envío desde `{tenant}_sendStatus`
               (email: 2 saltos vía `{tenant}_sendDetail`). Si entregado/leído (según
               confirmOn) → `confirmed`. Si falló o venció el timeout → escala al
               siguiente canal (o `exhausted` si no hay más).

Reutiliza el plumbing existente: workers `Send-batch-*` (encolando 1 contacto),
`sendStatus`/`ReceptionStatus` (entrega/lectura), `pricingRate` (costo), monedero
(reserve/refund atómicos), blacklist/unsubscribe (consentimiento).

⚠️ Sincronía de tarifas: DEFAULT_RATES está replicado de Cost_Estimate/Prepare-batch
(no hay módulo compartido). Si cambian allá, replicar aquí.
'''
import json
import os
import re
import time
import uuid
from datetime import datetime
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Key

REGION = 'us-east-1'
ACCOUNT = os.environ.get('AWS_ACCOUNT_ID', '873837768806')


def _q(name):
    return 'https://sqs.{}.amazonaws.com/{}/{}'.format(REGION, ACCOUNT, name)


URL_EM = os.environ.get('URL_SQS_EM', _q('Email_Send-batch-template-EM'))
URL_SMS = os.environ.get('URL_SQS_SMS', _q('Sms_Send-batch'))
URL_WSP = os.environ.get('URL_SQS_WSP', _q('Wsp_Send-batch'))
URL_VOICE = os.environ.get('URL_SQS_VOICE', _q('Voice_Send-batch'))
QUEUE_BY_CHANNEL = {'EM': URL_EM, 'SMS': URL_SMS, 'WSP': URL_WSP, 'VOZ': URL_VOICE}

TICK_LIMIT = int(os.environ.get('CASCADE_TICK_LIMIT', '300'))
PHONE_CHANNELS = ('SMS', 'WSP', 'VOZ')
CHANNEL_MAP = {'EM': 'EMAIL', 'SMS': 'SMS', 'WSP': 'WHATSAPP', 'VOZ': 'VOICE'}
DEFAULT_TAX_RATE = 0.19
DEFAULT_RATES = {
    'EMAIL': {'baseEM': 8, 'baseEAU': 15, 'baseEAP': 40},
    'SMS': {'baseSms': 60},
    'WHATSAPP': {'baseMarketing': 90},
    'VOICE': {'basePerMinute': 120, 'avgMinutes': 0.5},
    'COMMON': {'taxRate': DEFAULT_TAX_RATE, 'minCampaign': 5000},
}
# Estados (ReceptionStatus): 1 enviado · 2 entregado · 3 rechazado · 4 abierto/leído ·
# 5 clic · 6 rebote · 7 queja.
DELIVERED_STATES = {2, 4, 5, 7}
READ_STATES = {4, 5}
FAILED_STATES = {3, 6}

dynamodb = boto3.resource('dynamodb', region_name=REGION)
sqs = boto3.client('sqs', region_name=REGION)
table_run = dynamodb.Table('cascadeRun')
table_contact = dynamodb.Table('cascadeContact')
table_balance = dynamodb.Table('customerBalance')
table_wallet = dynamodb.Table('walletTransaction')
table_rates = dynamodb.Table('pricingRate')


def tenant_key(nit):
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def _num(value, default=0.0):
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


# --- Costo (replica de Cost_Estimate/Prepare-batch) --------------------------
def _load_rate(customer_id, channel):
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


def _unit(rate, channel_code):
    if channel_code == 'EM':
        return rate.get('baseEM', 8)
    if channel_code == 'SMS':
        return rate.get('baseSms', 60)
    if channel_code == 'WSP':
        return rate.get('baseMarketing', 90)
    if channel_code == 'VOZ':
        return rate.get('basePerMinute', 120) * rate.get('avgMinutes', 0.5)
    return 0.0


def per_send_cost(customer_id, channel_code):
    """Costo COP de UN mensaje en el canal (unitario + IVA, sin mínimo por campaña)."""
    rate = _load_rate(customer_id, CHANNEL_MAP.get(channel_code))
    unit = _unit(rate, channel_code)
    return int(round(unit * (1 + rate.get('taxRate', DEFAULT_TAX_RATE))))


# --- Monedero (débito/reembolso atómico) -------------------------------------
class InsufficientBalance(Exception):
    pass


def _ledger(customer_id, tx_type, amount, balance_after, ref, detail, now):
    try:
        table_wallet.put_item(Item={
            'txId': str(uuid.uuid4()), 'customerId': customer_id, 'type': tx_type,
            'amount': int(amount), 'balanceAfter': int(balance_after), 'currency': 'COP',
            'status': 'approved', 'actor': 'sistema', 'reference': str(ref),
            'detail': str(detail), 'createdAt': now})
    except Exception as e:
        print('walletTransaction: {}'.format(e))


def reserve_balance(customer_id, cost, ref, detail, now):
    """Débito atómico condicionado a balance >= cost. Devuelve None si la tabla no existe
    (rollout: no cobra). Lanza InsufficientBalance si no alcanza."""
    if cost <= 0:
        return 0
    try:
        resp = table_balance.update_item(
            Key={'customerId': customer_id},
            UpdateExpression='SET balance = balance - :c, updatedAt = :now',
            ConditionExpression='balance >= :c',
            ExpressionAttributeValues={':c': cost, ':now': now},
            ReturnValues='UPDATED_NEW')
    except ClientError as e:
        code = e.response['Error']['Code']
        if code == 'ConditionalCheckFailedException':
            raise InsufficientBalance()
        if code == 'ResourceNotFoundException':
            return None
        raise
    nb = int(resp['Attributes']['balance'])
    _ledger(customer_id, 'debit_send', -cost, nb, ref, detail, now)
    return nb


def refund_balance(customer_id, cost, ref, detail, now):
    if cost <= 0:
        return
    try:
        resp = table_balance.update_item(
            Key={'customerId': customer_id},
            UpdateExpression='SET balance = if_not_exists(balance, :z) + :c, updatedAt = :now',
            ExpressionAttributeValues={':c': cost, ':z': 0, ':now': now},
            ReturnValues='UPDATED_NEW')
        _ledger(customer_id, 'refund_send', cost, int(resp['Attributes']['balance']), ref, detail, now)
    except Exception as e:
        print('refund: {}'.format(e))


# --- Consentimiento ----------------------------------------------------------
def _suppressed(tenant, contact):
    """¿El contacto está en blacklist o unsubscribe del cliente? (PK 'email' guarda el
    contacto: correo o celular E.164). Fail-open."""
    if not contact:
        return False
    for suffix in ('_blackList', '_unsubscribe'):
        try:
            if dynamodb.Table(tenant + suffix).get_item(Key={'email': contact}).get('Item'):
                return True
        except Exception:
            pass
    return False


# --- Tablas por tenant (los workers NO las crean) ----------------------------
def _ensure_table(name, keys):
    try:
        dynamodb.meta.client.describe_table(TableName=name)
        return
    except Exception:
        pass
    try:
        dynamodb.create_table(
            TableName=name,
            KeySchema=[{'AttributeName': k, 'KeyType': t} for k, t in keys],
            AttributeDefinitions=[{'AttributeName': k, 'AttributeType': 'S'} for k, _ in keys],
            BillingMode='PAY_PER_REQUEST')
    except Exception as e:
        print('No se pudo crear {}: {}'.format(name, e))


def _ensure_tenant_tables(tenant, need_email):
    _ensure_table('{}_sendStatus'.format(tenant), [('processId', 'HASH'), ('sendStatusId', 'RANGE')])
    if need_email:
        _ensure_table('{}_processDetail'.format(tenant), [('processDetailId', 'HASH')])
        _ensure_table('{}_sendDetail'.format(tenant), [('processId', 'HASH'), ('sendDetailId', 'RANGE')])


# --- Envío de un contacto (encola 1 fila al worker del canal) ----------------
def _msg_row(contact, channel):
    addr = contact.get('email') if channel == 'EM' else contact.get('phone')
    return [contact['cascadeContactId'], addr] + [str(c) for c in (contact.get('row') or [])]


def _headers(run):
    return ['Identificacion', 'Contacto'] + [str(c) for c in (run.get('columns') or [])]


def _enqueue(run, contact, step, process_id):
    ch = step['channel']
    row = _msg_row(contact, ch)
    base = {'customerId': run['customerId'], 'customerName': run.get('customer', ''),
            'nit': run.get('nit'), 'processId': process_id, 'campaignId': run['cascadeRunId'],
            'samples': False, 'part': 0, 'data': [row]}
    if ch == 'EM':
        body = dict(base, fromEmail=step['from'], headers=_headers(run), templateName=step['template'])
    elif ch == 'SMS':
        body = dict(base, headers=_headers(run), smsBody=step['body'])
    elif ch == 'WSP':
        body = dict(base, wspTemplate=step['hsm'])  # params = row[2:]
    else:  # VOZ
        body = dict(base, headers=_headers(run), voiceMessage=step['voiceText'])
    sqs.send_message(QueueUrl=QUEUE_BY_CHANNEL[ch], MessageBody=json.dumps(body, default=str))


# --- Lectura del resultado ---------------------------------------------------
def _query_states(table_name, process_id, predicate):
    try:
        table = dynamodb.Table(table_name)
        items = []
        kwargs = {'KeyConditionExpression': Key('processId').eq(process_id)}
        while True:
            r = table.query(**kwargs)
            items.extend(r.get('Items', []))
            if not r.get('LastEvaluatedKey'):
                break
            kwargs['ExclusiveStartKey'] = r['LastEvaluatedKey']
        return items
    except Exception:
        return []


def read_states(run, contact, channel, process_id):
    tenant = tenant_key(run.get('nit'))
    cid = str(contact['cascadeContactId'])
    if channel == 'EM':
        detail = _query_states('{}_sendDetail'.format(tenant), process_id, None)
        msg_ids = {d.get('sendDetailId') for d in detail if str(d.get('uniqueId')) == cid}
        if not msg_ids:
            return set()
        rows = _query_states('{}_sendStatus'.format(tenant), process_id, None)
        return {int(_num(i.get('state'))) for i in rows if i.get('messageId') in msg_ids and i.get('state') is not None}
    rows = _query_states('{}_sendStatus'.format(tenant), process_id, None)
    return {int(_num(i.get('state'))) for i in rows if str(i.get('uniqueId')) == cid and i.get('state') is not None}


def is_confirmed(states, confirm_on, channel):
    if confirm_on == 'read':
        if states & READ_STATES:
            return True
        if channel in PHONE_CHANNELS and (states & DELIVERED_STATES):
            return True  # SMS/Voz no tienen "leído": entregado/contestado cuenta
        return False
    return bool(states & DELIVERED_STATES)


def is_failed(states):
    return bool(states & FAILED_STATES) and not (states & DELIVERED_STATES)


# --- Transiciones ------------------------------------------------------------
def _set_status(contact_id, expected, new_status, extra=None, extra_names=None, extra_values=None):
    """UpdateItem condicional (claim idempotente). Devuelve True si ganó la transición."""
    expr = 'SET #s = :new, updatedAt = :u'
    names = {'#s': 'status'}
    values = {':new': new_status, ':u': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'), ':exp': expected}
    if extra:
        expr += ', ' + extra
    if extra_names:
        names.update(extra_names)
    if extra_values:
        values.update(extra_values)
    try:
        table_contact.update_item(
            Key={'cascadeContactId': contact_id},
            UpdateExpression=expr, ConditionExpression='#s = :exp',
            ExpressionAttributeNames=names, ExpressionAttributeValues=values)
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise


def _send_pending(run, contact, now_epoch, now_s, spent_ref):
    """Contacto `pending`: busca el primer canal usable desde stepIndex, cobra y envía.
    Devuelve 'sent' | 'exhausted' | 'insufficient' | 'budget' | 'skip'."""
    steps = run.get('steps') or []
    budget = run.get('budgetCap')
    idx = int(contact.get('stepIndex', 0))
    tenant = tenant_key(run.get('nit'))
    # Salta canales sin dirección o suprimidos hasta encontrar uno usable.
    while idx < len(steps):
        step = steps[idx]
        ch = step['channel']
        addr = contact.get('email') if ch == 'EM' else contact.get('phone')
        if addr and not _suppressed(tenant, addr):
            break
        idx += 1
    if idx >= len(steps):
        _set_status(contact['cascadeContactId'], contact.get('status'), 'exhausted',
                    'stepIndex = :i', None, {':i': idx})
        return 'exhausted'
    step = steps[idx]
    ch = step['channel']
    cost = per_send_cost(run['customerId'], ch)
    if budget is not None and spent_ref[0] + cost > budget:
        _set_status(contact['cascadeContactId'], contact.get('status'), 'exhausted',
                    'note = :n', None, {':n': 'presupuesto'})
        return 'budget'
    # Claim: (pending)→awaiting ANTES de cobrar/enviar (evita doble envío entre ticks).
    process_id = 'csc-{}-{}'.format(contact['cascadeContactId'], idx)
    won = _set_status(
        contact['cascadeContactId'], contact.get('status'), 'awaiting',
        'stepIndex = :i, currentChannel = :c, processId = :p, nextEscalationAt = :n',
        None,
        {':i': idx, ':c': ch, ':p': process_id,
         ':n': now_epoch + int(run.get('stepTimeoutMin', 60)) * 60})
    if not won:
        return 'skip'
    # Reserva de saldo (después del claim → un solo débito).
    try:
        nb = reserve_balance(run['customerId'], cost, run['cascadeRunId'],
                             "Cascada '{}' ({})".format(run.get('name', ''), ch), now_s)
    except InsufficientBalance:
        _set_status(contact['cascadeContactId'], 'awaiting', 'pending', 'nextEscalationAt = :z', None, {':z': 0})
        return 'insufficient'
    charged = 0 if nb is None else cost
    try:
        _enqueue(run, contact, step, process_id)
    except Exception as e:
        print('enqueue falló ({}): {}'.format(ch, e))
        if charged:
            refund_balance(run['customerId'], charged, run['cascadeRunId'], 'reembolso enqueue', now_s)
        # Queda awaiting → al vencer el timeout escala/reintenta el siguiente canal.
        return 'skip'
    # Registra intento + costo en el contacto.
    attempt = {'channel': ch, 'at': now_s, 'processId': process_id, 'cost': charged, 'outcome': 'sent'}
    try:
        table_contact.update_item(
            Key={'cascadeContactId': contact['cascadeContactId']},
            UpdateExpression='SET spent = if_not_exists(spent, :z) + :c, attempts = list_append(if_not_exists(attempts, :empty), :a)',
            ExpressionAttributeValues={':c': charged, ':z': 0, ':empty': [], ':a': [attempt]})
    except Exception as e:
        print('no se pudo registrar intento: {}'.format(e))
    spent_ref[0] += charged
    return 'sent'


def _check_awaiting(run, contact, now_epoch, now_s):
    """Contacto `awaiting`: lee estado; confirma, o escala por fallo/timeout."""
    steps = run.get('steps') or []
    ch = contact.get('currentChannel')
    process_id = contact.get('processId')
    states = read_states(run, contact, ch, process_id) if process_id else set()
    if is_confirmed(states, run.get('confirmOn', 'delivered'), ch):
        _set_status(contact['cascadeContactId'], 'awaiting', 'confirmed',
                    'lastState = :ls', None, {':ls': max(states) if states else 2})
        return 'confirmed'
    timed_out = now_epoch >= int(_num(contact.get('nextEscalationAt'), 0))
    if is_failed(states) or timed_out:
        next_idx = int(contact.get('stepIndex', 0)) + 1
        if next_idx < len(steps):
            _set_status(contact['cascadeContactId'], 'awaiting', 'pending',
                        'stepIndex = :i, nextEscalationAt = :z', None, {':i': next_idx, ':z': 0})
            return 'escalated'
        _set_status(contact['cascadeContactId'], 'awaiting', 'exhausted',
                    'lastState = :ls', None, {':ls': max(states) if states else 0})
        return 'exhausted'
    return 'waiting'


def _iter_contacts(run_id):
    kwargs = {'IndexName': 'cascadeRunId-index',
              'KeyConditionExpression': Key('cascadeRunId').eq(run_id)}
    while True:
        r = table_contact.query(**kwargs)
        for it in r.get('Items', []):
            yield it
        if not r.get('LastEvaluatedKey'):
            break
        kwargs['ExclusiveStartKey'] = r['LastEvaluatedKey']


def process_run(run):
    run_id = run['cascadeRunId']
    steps = run.get('steps') or []
    _ensure_tenant_tables(tenant_key(run.get('nit')), any(s.get('channel') == 'EM' for s in steps))
    now_epoch = int(time.time())
    now_s = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    spent_ref = [int(_num((run.get('counts') or {}).get('spent', 0)))]
    counts = {'total': 0, 'confirmed': 0, 'exhausted': 0, 'inProgress': 0, 'pending': 0}
    processed = 0
    paused = False
    for contact in _iter_contacts(run_id):
        st = contact.get('status')
        counts['total'] += 1
        if processed < TICK_LIMIT and st == 'pending':
            res = _send_pending(run, contact, now_epoch, now_s, spent_ref)
            processed += 1
            if res == 'insufficient':
                paused = True
            st = 'exhausted' if res in ('exhausted', 'budget') else ('awaiting' if res == 'sent' else st)
        elif processed < TICK_LIMIT and st == 'awaiting':
            res = _check_awaiting(run, contact, now_epoch, now_s)
            processed += 1
            st = {'confirmed': 'confirmed', 'exhausted': 'exhausted', 'escalated': 'pending'}.get(res, 'awaiting')
        # tally (estado ya actualizado en memoria)
        if st == 'confirmed':
            counts['confirmed'] += 1
        elif st == 'exhausted':
            counts['exhausted'] += 1
        elif st in ('pending', 'awaiting', 'sending'):
            counts['inProgress'] += 1
    # Estado del run
    new_counts = {'total': counts['total'], 'confirmed': counts['confirmed'],
                  'exhausted': counts['exhausted'], 'inProgress': counts['inProgress'],
                  'skipped': 0, 'spent': spent_ref[0]}
    if paused:
        new_status = 'paused'
    elif counts['inProgress'] == 0 and counts['total'] > 0:
        new_status = 'done'
    else:
        new_status = 'running'
    upd = 'SET #c = :c, #st = :s'
    vals = {':c': new_counts, ':s': new_status}
    if new_status == 'done':
        upd += ', finishedAt = :f'
        vals[':f'] = now_s
    try:
        table_run.update_item(
            Key={'cascadeRunId': run_id}, UpdateExpression=upd,
            ExpressionAttributeNames={'#c': 'counts', '#st': 'status'},
            ExpressionAttributeValues=vals)
    except Exception as e:
        print('no se pudo actualizar el run: {}'.format(e))
    return {'runId': run_id, 'processed': processed, 'status': new_status, 'counts': new_counts}


def _running_runs():
    kwargs = {'FilterExpression': Key('status').eq('running')} if False else {}
    # Scan por status=running (tabla pequeña). Usa ExpressionAttributeNames (status reservado).
    out = []
    scan_kwargs = {'FilterExpression': '#s = :r',
                   'ExpressionAttributeNames': {'#s': 'status'},
                   'ExpressionAttributeValues': {':r': 'running'}}
    while True:
        r = table_run.scan(**scan_kwargs)
        out.extend(r.get('Items', []))
        if not r.get('LastEvaluatedKey'):
            break
        scan_kwargs['ExclusiveStartKey'] = r['LastEvaluatedKey']
    return out


def lambda_handler(event, context):
    event = event if isinstance(event, dict) else {}
    run_id = event.get('cascadeRunId')
    if run_id:
        run = table_run.get_item(Key={'cascadeRunId': run_id}).get('Item')
        runs = [run] if run and run.get('status') == 'running' else []
    else:
        runs = _running_runs()
    results = [process_run(run) for run in runs if run]
    return {'status': True, 'statusCode': 200, 'description': 'tick',
            'data': {'runs': len(results), 'results': results}}
