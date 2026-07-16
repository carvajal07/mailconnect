'''
Lambda de RECEPCIÓN DE ESTADOS para WhatsApp (canal WSP).

Equivalente a Api_V1_Messaging_ReceptionStatus (SMS/Voz), pero WhatsApp es DISTINTO: los
recibos de entrega/lectura los emite **Meta** (WhatsApp Business Platform) y llegan por la
SNS de AWS End User Messaging Social. El evento de Meta trae SOLO el messageId y el estado
(sent/delivered/read/failed), SIN nuestro context (customer/proceso).

Por eso el envío (Api_V1_Wsp_Send-batch) guarda un ÍNDICE global `messageIndex`
(PK messageId → {customer, processId, uniqueId}); esta lambda lo consulta para saber a qué
cliente/proceso pertenece cada recibo y AÑADE una fila a {customer}_sendStatus (mismo
esquema que el resto), de modo que Reports/Statistics reflejen entregado/leído/fallido.

Trigger: SNS de End User Messaging Social (WhatsApp).

Mapeo de estado de Meta → nuestros códigos:
  sent → 1 (enviado) · delivered → 2 (entregado) · read → 4 (abierto/leído) · failed → 3 (rechazado)
'''
import os
import re
import json
import uuid
import boto3
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)


def tenant_key(nit):
    """Llave de tenant (NIT saneado) para las tablas por cliente ({tenant}_sendStatus,
    _sendState, _sendSummary). Igual que en Prepare-batch/buckets. Idempotente."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())

MESSAGE_INDEX_TABLE = os.environ.get('WSP_MESSAGE_INDEX', 'messageIndex')
table_index = dynamodb.Table(MESSAGE_INDEX_TABLE)

STATE_SENT = 1
STATE_DELIVERED = 2
STATE_REJECTED = 3
STATE_READ = 4  # 'abierto' en nuestro embudo (read receipt de WhatsApp)

# Estado de Meta (WhatsApp Cloud API) → nuestro código.
META_STATE = {
    'sent': STATE_SENT,
    'delivered': STATE_DELIVERED,
    'read': STATE_READ,
    'failed': STATE_REJECTED,
    'warning': STATE_SENT,     # aviso no terminal; se cuenta como enviado
    'deleted': STATE_REJECTED,
}


def _parse_json(raw):
    if isinstance(raw, (dict, list)):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return None
    return None


def _iter_sns_messages(event):
    """Cada Record de SNS/SQS→SNS trae un `Message` (string JSON) que End User Messaging
    Social publica. Devuelve ese objeto ya parseado."""
    for record in (event.get('Records') or []):
        raw = None
        if 'Sns' in record:
            raw = record['Sns'].get('Message')
        elif 'body' in record:
            body = _parse_json(record['body'])
            raw = (body or {}).get('Message', record['body']) if isinstance(body, dict) else record['body']
        msg = _parse_json(raw)
        if msg is not None:
            yield msg


def _iter_statuses(msg):
    """Extrae los objetos `status` del payload de EUM Social, tolerante al envoltorio.

    El webhook de Meta viaja como STRING en un campo del mensaje (según versión de AWS:
    `whatsAppWebhookEntry`, `webhook_entry`, `webhookEntry`, `entry`...). El entry de Meta
    es: {changes:[{value:{statuses:[{id,status,timestamp,recipient_id}]}}]}. Se busca
    `statuses` de forma robusta en cualquiera de esas formas.
    """
    entries = []
    if isinstance(msg, dict):
        for key in ('whatsAppWebhookEntry', 'webhook_entry', 'webhookEntry', 'entry', 'Entry'):
            if key in msg:
                parsed = _parse_json(msg[key])
                if parsed is not None:
                    entries.append(parsed)
        # A veces el propio mensaje YA es el entry (trae 'changes').
        if 'changes' in msg:
            entries.append(msg)
        # O trae directamente 'statuses'.
        if 'statuses' in msg:
            for st in msg['statuses'] or []:
                yield st
    elif isinstance(msg, list):
        entries.extend(msg)

    for entry in entries:
        entry_list = entry if isinstance(entry, list) else [entry]
        for e in entry_list:
            if not isinstance(e, dict):
                continue
            for change in (e.get('changes') or []):
                value = (change or {}).get('value') or {}
                for st in (value.get('statuses') or []):
                    yield st
            # Entry que ya trae statuses directo.
            for st in (e.get('statuses') or []):
                yield st


def _lookup(message_id):
    """(tenant, processId, uniqueId) del índice para un messageId; None si no está. `tenant`
    es la llave por NIT (tenant_key) con la que se nombra {tenant}_sendStatus; fallback al
    'customer' (nombre) para filas antiguas del índice."""
    try:
        item = table_index.get_item(Key={'messageId': message_id}).get('Item')
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return None
        raise
    if not item:
        return None
    tenant = tenant_key(item.get('nit', '')) or tenant_key(item.get('customer', ''))
    return tenant, item.get('processId', ''), item.get('uniqueId', '')


def _record_status(tenant, process_id, item):
    item['processId'] = process_id
    dynamodb.Table('{}_sendStatus'.format(tenant)).put_item(Item=item)


# ── Pre-agregación de contadores (idéntica a Messaging_ReceptionStatus; best-effort) ──
# Se mantiene SIEMPRE (por defecto, sin env); best-effort si faltan las tablas de resumen.
_SUMMARY_PRIORITY = {1: 1, 9: 2, 8: 3, 3: 4, 2: 5, 6: 6, 10: 7, 7: 8, 4: 9, 5: 10}


def _summary_milestones(state_num):
    if not state_num:
        return set()
    s = int(state_num)
    ms = {'enviados'}
    if s in (2, 4, 5, 7):
        ms.add('entregados')
    if s in (4, 5):
        ms.add('abiertos')
    if s == 5:
        ms.add('clics')
    if s in (3, 6):
        ms.add('rebotes')
    if s == 7:
        ms.add('quejas')
    return ms


def bump_send_summary(tenant, process_id, message_id, state):
    if not (tenant and process_id and message_id):
        return
    try:
        new_state = int(state)
    except (TypeError, ValueError):
        return
    if new_state <= 0:
        return
    new_prio = _SUMMARY_PRIORITY.get(new_state, 0)
    try:
        resp = dynamodb.Table('{}_sendState'.format(tenant)).update_item(
            Key={'processId': process_id, 'messageId': message_id},
            UpdateExpression='SET #s = :s, #p = :p',
            ConditionExpression='attribute_not_exists(#p) OR #p < :p',
            ExpressionAttributeNames={'#s': 'state', '#p': 'prio'},
            ExpressionAttributeValues={':s': new_state, ':p': new_prio},
            ReturnValues='ALL_OLD')
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return
        print('sendSummary(state): {}'.format(e))
        return
    except Exception as e:
        print('sendSummary(state): {}'.format(e))
        return
    old_state = (resp.get('Attributes') or {}).get('state')
    gained = _summary_milestones(new_state) - _summary_milestones(old_state)
    lost = _summary_milestones(old_state) - _summary_milestones(new_state)
    if not gained and not lost:
        return
    parts, names, vals = [], {}, {}
    for i, m in enumerate(list(gained) + list(lost)):
        parts.append('#m{0} :v{0}'.format(i))
        names['#m{0}'.format(i)] = m
        vals[':v{0}'.format(i)] = 1 if m in gained else -1
    try:
        dynamodb.Table('{}_sendSummary'.format(tenant)).update_item(
            Key={'processId': process_id},
            UpdateExpression='ADD ' + ', '.join(parts),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=vals)
    except Exception as e:
        print('sendSummary(counters): {}'.format(e))


def lambda_handler(event, context):
    procesados = 0
    sin_indice = 0
    for msg in _iter_sns_messages(event):
        for st in _iter_statuses(msg):
            message_id = st.get('id') or st.get('messageId') or st.get('MessageId')
            status_raw = str(st.get('status') or st.get('Status') or '').lower()
            state = META_STATE.get(status_raw)
            if not message_id or state is None:
                print('Recibo WhatsApp ignorado (id/estado no mapeado): {}'.format(status_raw))
                continue

            found = _lookup(message_id)
            if not found:
                # El recibo llegó pero no tenemos el messageId indexado (envío anterior a
                # esta función, o índice no provisionado). No se puede ubicar el proceso.
                sin_indice += 1
                continue
            tenant, process_id, unique_id = found
            if not tenant or not process_id:
                sin_indice += 1
                continue

            timestamp = str(st.get('timestamp') or st.get('Timestamp') or '')
            phone = str(st.get('recipient_id') or st.get('recipientId') or '')
            item = {
                'sendStatusId': str(uuid.uuid4()),
                'messageId': message_id,
                'uniqueId': unique_id,
                'phone': phone,
                'date': timestamp,
                'state': state,
                'type1': 'WSP',
                'type2': status_raw,
            }
            try:
                _record_status(tenant, process_id, item)
                bump_send_summary(tenant, process_id, message_id, state)
                procesados += 1
            except Exception as e:
                print('No se pudo registrar el recibo WhatsApp ({}): {}'.format(status_raw, e))

    if sin_indice:
        print('Recibos WhatsApp sin índice (no ubicados): {}'.format(sin_indice))
    return {'statusCode': 200, 'body': json.dumps({'procesados': procesados, 'sinIndice': sin_indice})}
