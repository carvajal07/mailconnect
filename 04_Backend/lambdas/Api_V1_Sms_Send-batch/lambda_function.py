'''
Lambda de envío de SMS en lotes (canal SMS).

Trigger: cola SQS `Sms_Send-batch` (la llena Api_V1_Email_Prepare-batch-template para
campañas con channel="SMS", mismo patrón que los envíos de email).

Envía cada SMS con AWS End User Messaging SMS (pinpoint-sms-voice-v2 → SendTextMessage)
y registra el estado en {customer}_sendStatus_{processId} (igual que el email), para que
los reportes y estadísticas funcionen sin cambios.

Estructura de la data (CSV): línea = [identificación, contacto, nombre, ...opcionales].
En SMS la columna 2 (line[1]) es el CELULAR en formato E.164 (+57...). El texto del
mensaje viene en `smsBody` (el campo `template` de la campaña) y admite variables
{{col}} que se reemplazan con los encabezados del CSV.

Env:
  SMS_ORIGINATION_IDENTITY  — Sender ID / número/pool de origen en AWS End User Messaging
                              (obligatorio; sin esto AWS rechaza el envío).
  SMS_CONFIGURATION_SET      — (opcional) configuration set para recibir eventos de entrega.
'''
import os
import re
import json
import uuid
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

REGION = 'us-east-1'
ORIGINATION_IDENTITY = os.environ.get('SMS_ORIGINATION_IDENTITY', '')
CONFIGURATION_SET = os.environ.get('SMS_CONFIGURATION_SET', '')

dynamodb = boto3.resource('dynamodb', region_name=REGION)
sms = boto3.client('pinpoint-sms-voice-v2', region_name=REGION)

# Estado 1 = Enviado, 3 = Rechazado (mismo mapa que el email/ReceptionStatus).
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
    """Inserta los estados de envío en {customer}_sendStatus_{proceso} por lotes."""
    table = dynamodb.Table(f'{customer_name}_sendStatus_{process_id}')
    with table.batch_writer() as batch:
        for item in rows:
            batch.put_item(Item=item)


def lambda_handler(event, context):
    now = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

    for record in event.get('Records', []):
        try:
            body = json.loads(record['body'])
        except Exception as e:
            print('Mensaje SQS ilegible: {}'.format(e))
            continue

        customer_name = body.get('customerName', '')
        process_id = body.get('processId', '')
        headers = body.get('headers', [])
        sms_body = body.get('smsBody', '') or ''
        data = body.get('data', [])
        print(f'SMS lote: cliente={customer_name} proceso={process_id} registros={len(data)}')

        if not ORIGINATION_IDENTITY:
            print('SMS_ORIGINATION_IDENTITY no configurada; no se puede enviar.')

        status_rows = []
        for row in data:
            if not isinstance(row, list) or len(row) < 2:
                continue
            unique_id = str(row[0])
            phone = str(row[1]).strip()
            message = _personalize(sms_body, headers, row)

            state = STATE_SENT
            message_id = str(uuid.uuid4())
            error = ''
            try:
                if not ORIGINATION_IDENTITY:
                    raise RuntimeError('Sin identidad de origen SMS configurada')
                params = {
                    'DestinationPhoneNumber': phone,
                    'OriginationIdentity': ORIGINATION_IDENTITY,
                    'MessageBody': message,
                    'MessageType': 'TRANSACTIONAL',
                    # Metadata que EUM incluye en los eventos de entrega (SNS) para que
                    # ReceptionStatus sepa a qué cliente/proceso pertenece cada estado.
                    'Context': {'customer': customer_name, 'processId': process_id, 'uniqueId': unique_id},
                }
                if CONFIGURATION_SET:
                    params['ConfigurationSetName'] = CONFIGURATION_SET
                resp = sms.send_text_message(**params)
                message_id = resp.get('MessageId', message_id)
            except (ClientError, Exception) as e:
                state = STATE_REJECTED
                error = str(e)
                print(f'Fallo SMS a {phone}: {error}')

            status_rows.append({
                'sendStatusId': str(uuid.uuid4()),
                'messageId': message_id,
                'uniqueId': unique_id,
                'phone': phone,
                'date': now,
                'state': state,
                'type1': 'SMS',
                'type2': error[:250] if error else 'SMS enviado',
            })

        if status_rows and process_id and customer_name:
            try:
                _record_status(customer_name, process_id, status_rows)
            except Exception as e:
                print('No se pudieron registrar los estados SMS: {}'.format(e))

    return {'statusCode': 200, 'body': json.dumps('SMS batch procesado')}
