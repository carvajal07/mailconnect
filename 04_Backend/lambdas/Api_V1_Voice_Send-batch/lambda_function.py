'''
Lambda de envío de VOZ en lotes (canal VOZ).

Trigger: cola SQS `Voice_Send-batch` (la llena Api_V1_Email_Prepare-batch-template para
campañas con channel="VOZ", mismo patrón que email/SMS/WhatsApp).

Realiza una llamada telefónica y reproduce un mensaje con texto a voz (TTS) usando AWS
End User Messaging Voice (cliente boto3 `pinpoint-sms-voice-v2` → `send_voice_message`).
El mensaje se sintetiza con una voz de Amazon Polly (VOICE_ID, español por defecto).
Registra el estado en {customer}_sendStatus_{proceso} (igual que email/SMS/WhatsApp →
reportes y estadísticas funcionan sin cambios).

Estructura de la data (CSV): línea = [identificación, CELULAR E.164, nombre, ...opcionales].
En VOZ la columna 2 (line[1]) es el celular E.164 (+57...). El texto a leer viene en
`voiceMessage` (el campo `template` de la campaña) y admite variables {{col}} que se
reemplazan con los encabezados del CSV.

Env:
  VOICE_ORIGINATION_IDENTITY  — número/pool de origen habilitado para voz en End User
                                Messaging (obligatorio; sin esto AWS rechaza la llamada).
  VOICE_ID                    — voz de Polly (default 'LUPE', español). Ej.: CONCHITA, MIA.
  VOICE_CONFIGURATION_SET     — (opcional) configuration set para eventos de la llamada.
  VOICE_BODY_TEXT_TYPE        — 'TEXT' (default) o 'SSML' si el mensaje trae marcado SSML.
'''
import os
import re
import json
import uuid
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

REGION = 'us-east-1'
ORIGINATION_IDENTITY = os.environ.get('VOICE_ORIGINATION_IDENTITY', '')
VOICE_ID = os.environ.get('VOICE_ID', 'LUPE')  # voz en español de Amazon Polly
CONFIGURATION_SET = os.environ.get('VOICE_CONFIGURATION_SET', '')
BODY_TEXT_TYPE = os.environ.get('VOICE_BODY_TEXT_TYPE', 'TEXT')  # TEXT | SSML


def _mask_phone(phone):
    p = str(phone)
    return (p[:4] + '***' + p[-2:]) if len(p) > 6 else '***'

dynamodb = boto3.resource('dynamodb', region_name=REGION)
voice = boto3.client('pinpoint-sms-voice-v2', region_name=REGION)

# Estado 1 = Enviado (llamada iniciada), 3 = Rechazado (mismo mapa que email/SMS).
STATE_SENT = 1
STATE_REJECTED = 3

_VAR = re.compile(r'\{\{\s*([\w.-]+)\s*\}\}')


def _personalize(text, headers, row):
    """Reemplaza {{columna}} con el valor de esa columna del registro."""
    if not text:
        return ''
    values = dict(zip(headers, row))
    return _VAR.sub(lambda m: str(values.get(m.group(1), m.group(0))), text)


def _record_status(customer_name, process_id, rows):
    """Inserta los estados de envío en la tabla ÚNICA {customer}_sendStatus por lotes.
    processId es la PK (una partición por proceso) y sendStatusId la SK."""
    table = dynamodb.Table(f'{customer_name}_sendStatus')
    with table.batch_writer() as batch:
        for item in rows:
            item['processId'] = process_id
            batch.put_item(Item=item)


def lambda_handler(event, context):
    now = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

    if not ORIGINATION_IDENTITY:
        raise RuntimeError('VOICE_ORIGINATION_IDENTITY no configurada; no se procesa el lote.')

    for record in event.get('Records', []):
        try:
            body = json.loads(record['body'])
        except Exception as e:
            print('Mensaje SQS ilegible: {}'.format(e))
            continue

        customer_name = body.get('customerName', '')
        process_id = body.get('processId', '')
        headers = body.get('headers', [])
        voice_message = body.get('voiceMessage', '') or ''
        data = body.get('data', [])
        print(f'VOZ lote: cliente={customer_name} proceso={process_id} registros={len(data)}')


        status_rows = []
        for row in data:
            if not isinstance(row, list) or len(row) < 2:
                continue
            unique_id = str(row[0])
            phone = str(row[1]).strip()
            message = _personalize(voice_message, headers, row)

            state = STATE_SENT
            message_id = str(uuid.uuid4())
            error = ''
            try:
                if not message.strip():
                    raise RuntimeError('La campaña no tiene mensaje de voz (template vacío)')
                params = {
                    'DestinationPhoneNumber': phone,
                    'OriginationIdentity': ORIGINATION_IDENTITY,
                    'MessageBody': message,
                    'MessageBodyTextType': BODY_TEXT_TYPE,
                    'VoiceId': VOICE_ID,
                    # Metadata que EUM incluye en los eventos de la llamada (SNS) para que
                    # ReceptionStatus sepa a qué cliente/proceso pertenece cada estado.
                    'Context': {'customer': customer_name, 'processId': process_id, 'uniqueId': unique_id},
                }
                if CONFIGURATION_SET:
                    params['ConfigurationSetName'] = CONFIGURATION_SET
                resp = voice.send_voice_message(**params)
                message_id = resp.get('MessageId', message_id)
            except (ClientError, Exception) as e:
                state = STATE_REJECTED
                error = str(e)
                print(f'Fallo VOZ a {_mask_phone(phone)}: {error}')

            status_rows.append({
                'sendStatusId': str(uuid.uuid4()),
                'messageId': message_id,
                'uniqueId': unique_id,
                'phone': phone,
                'date': now,
                'state': state,
                'type1': 'VOZ',
                'type2': error[:250] if error else 'Llamada iniciada',
            })

        if status_rows and process_id and customer_name:
            try:
                _record_status(customer_name, process_id, status_rows)
            except Exception as e:
                print('No se pudieron registrar los estados de voz: {}'.format(e))

    return {'statusCode': 200, 'body': json.dumps('Voice batch procesado')}
