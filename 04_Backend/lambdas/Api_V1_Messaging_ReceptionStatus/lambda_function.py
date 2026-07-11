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
import json
import uuid
import boto3

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)

STATE_SENT = 1
STATE_DELIVERED = 2
STATE_REJECTED = 3

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


def _record_status(customer_name, process_id, item):
    # Tabla ÚNICA {customer}_sendStatus (PK processId + SK sendStatusId).
    item['processId'] = process_id
    table = dynamodb.Table(f'{customer_name}_sendStatus')
    table.put_item(Item=item)


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
        process_id = ctx.get('processId', '')
        unique_id = ctx.get('uniqueId', '')
        if not customer_name or not process_id:
            print('Evento EUM sin customer/processId en el context; se omite.')
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
            _record_status(customer_name, process_id, item)
            procesados += 1
        except Exception as e:
            print('No se pudo registrar el estado EUM ({}): {}'.format(event_type, e))

    return {'statusCode': 200, 'body': json.dumps({'procesados': procesados})}
