'''
Lambda de RECEPCIÓN DE ESTADOS para los canales SMS y VOZ (AWS End User Messaging).

Equivalente a Api_V1_Email_ReceptionStatus (que maneja los eventos de SES), pero para los
eventos de End User Messaging (pinpoint-sms-voice-v2). El configuration set de SMS/Voz
publica los eventos en SNS; esta lambda los procesa y AÑADE una fila de estado a
{customer}_sendStatus_{proceso} (mismo esquema que el envío), para que Reports/Statistics
reflejen entregado/rechazado además de enviado.

Trigger: SNS (o SQS que envuelve SNS) del configuration set de EUM.

El cliente y el proceso viajan en el `context` del mensaje (lo pone el envío en el
parámetro Context de send_text_message / send_voice_message): {customer, processId, uniqueId}.

Códigos de estado (mismos que email):
  1 Enviado · 2 Entregado · 3 Rechazado/Fallido
'''
import os
import re
import json
import uuid
import boto3
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)

STATE_SENT = 1
STATE_DELIVERED = 2
STATE_REJECTED = 3


def tenant_key(nit):
    """Llave de tenant (NIT saneado) para las tablas por cliente ({tenant}_sendStatus,
    _sendState, _sendSummary). Igual que en Prepare-batch/buckets. Idempotente."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())

# Mapeo de eventType de End User Messaging (SMS y Voz) a nuestros códigos de estado.
EVENT_STATE = {
    # SMS
    'TEXT_QUEUED': STATE_SENT,
    'TEXT_PENDING': STATE_SENT,
    'TEXT_SENT': STATE_SENT,
    'TEXT_SUCCESSFUL': STATE_DELIVERED,
    'TEXT_DELIVERED': STATE_DELIVERED,
    'TEXT_BLOCKED': STATE_REJECTED,
    'TEXT_TTL_EXPIRED': STATE_REJECTED,
    'TEXT_CARRIER_BLOCKED': STATE_REJECTED,
    'TEXT_CARRIER_UNREACHABLE': STATE_REJECTED,
    'TEXT_INVALID': STATE_REJECTED,
    'TEXT_INVALID_MESSAGE': STATE_REJECTED,
    'TEXT_UNREACHABLE': STATE_REJECTED,
    'TEXT_SPAM': STATE_REJECTED,
    'TEXT_UNKNOWN': STATE_REJECTED,
    # Voz
    'VOICE_INITIATED': STATE_SENT,
    'VOICE_RINGING': STATE_SENT,
    'VOICE_SENT': STATE_SENT,
    'VOICE_ANSWERED': STATE_DELIVERED,
    'VOICE_COMPLETED': STATE_DELIVERED,
    'VOICE_BUSY': STATE_REJECTED,
    'VOICE_NO_ANSWER': STATE_REJECTED,
    'VOICE_FAILED': STATE_REJECTED,
    'VOICE_TTL_EXPIRED': STATE_REJECTED,
}


def _iter_events(event):
    """Extrae los eventos EUM de las envolturas posibles (SNS directo o SQS→SNS)."""
    for record in (event.get('Records') or []):
        raw = None
        if 'Sns' in record:                         # SNS directo → Lambda
            raw = record['Sns'].get('Message')
        elif 'body' in record:                      # SQS que envuelve SNS
            try:
                body = json.loads(record['body'])
            except Exception:
                continue
            raw = body.get('Message', record['body'])
        if raw is None:
            continue
        try:
            msg = json.loads(raw) if isinstance(raw, str) else raw
        except Exception:
            continue
        # El configuration set puede publicar un evento o una lista de eventos.
        if isinstance(msg, list):
            for m in msg:
                yield m
        else:
            yield msg


def _record_status(tenant, process_id, item):
    # Tabla ÚNICA {tenant}_sendStatus (PK processId + SK sendStatusId). tenant=tenant_key(NIT).
    item['processId'] = process_id
    table = dynamodb.Table(f'{tenant}_sendStatus')
    table.put_item(Item=item)


# ───────────────────────── Pre-agregación de contadores (opcional) ─────────────────────────
# Mantiene un RESUMEN por proceso ({customer}_sendSummary, PK processId) con el embudo ya
# contado, para que los reportes lean O(1) en vez de escanear millones de filas. Es
# transición-consciente: un mensaje que avanza de estado se mueve de bucket (suma el
# ganado, resta el perdido) usando su estado actual en {customer}_sendState (PK processId
# + SK messageId), actualizado con condición atómica (solo avanza en prioridad).
#
# Se mantiene SIEMPRE (por defecto, sin env). Best-effort: si las tablas de resumen no
# existen o algo falla, NO rompe la recepción (los reportes caen al scan por proceso).
_SUMMARY_PRIORITY = {1: 1, 9: 2, 8: 3, 3: 4, 2: 5, 6: 6, 10: 7, 7: 8, 4: 9, 5: 10}


def _summary_milestones(state_num):
    '''Buckets del embudo que implica un estado (mismo criterio que los reportes).'''
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
    '''Actualiza el resumen agregado del proceso ante un nuevo estado de un mensaje.
    Idempotente y transición-consciente; best-effort (nunca lanza). tenant=tenant_key(NIT).'''
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
        # Avanza el estado del mensaje SOLO si el nuevo tiene mayor prioridad (atómico).
        resp = dynamodb.Table('{}_sendState'.format(tenant)).update_item(
            Key={'processId': process_id, 'messageId': message_id},
            UpdateExpression='SET #s = :s, #p = :p',
            ConditionExpression='attribute_not_exists(#p) OR #p < :p',
            ExpressionAttributeNames={'#s': 'state', '#p': 'prio'},
            ExpressionAttributeValues={':s': new_state, ':p': new_prio},
            ReturnValues='ALL_OLD')
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return  # el mensaje ya estaba en un estado igual o mayor: nada que sumar
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
    for ev in _iter_events(event):
        event_type = ev.get('eventType') or ev.get('EventType') or ''
        state = EVENT_STATE.get(event_type)
        if state is None:
            print('Evento EUM ignorado (tipo no mapeado): {}'.format(event_type))
            continue

        ctx = ev.get('context') or ev.get('Context') or {}
        customer_name = ctx.get('customer', '')
        # Llave de las tablas por cliente: el `nit` (tenant_key) que puso el envío en el Context.
        tenant = tenant_key(ctx.get('nit', '')) or tenant_key(customer_name)
        process_id = ctx.get('processId', '')
        unique_id = ctx.get('uniqueId', '')
        if not tenant or not process_id:
            print('Evento EUM sin nit/processId en el context; se omite.')
            continue

        message_id = ev.get('messageId') or ev.get('MessageId') or str(uuid.uuid4())
        phone = ev.get('destinationPhoneNumber') or ev.get('DestinationPhoneNumber') or ''
        timestamp = str(ev.get('eventTimestamp') or ev.get('EventTimestamp') or '')
        channel = 'VOZ' if event_type.startswith('VOICE') else 'SMS'

        item = {
            'sendStatusId': str(uuid.uuid4()),
            'messageId': message_id,
            'uniqueId': unique_id,
            'phone': phone,
            'date': timestamp,
            'state': state,
            'type1': channel,
            'type2': event_type,
        }
        try:
            _record_status(tenant, process_id, item)
            bump_send_summary(tenant, process_id, message_id, state)
            procesados += 1
        except Exception as e:
            print('No se pudo registrar el estado EUM ({}): {}'.format(event_type, e))

    return {'statusCode': 200, 'body': json.dumps({'procesados': procesados})}
