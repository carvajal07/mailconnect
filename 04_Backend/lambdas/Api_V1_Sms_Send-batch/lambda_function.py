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
# Tipo de mensaje: para campañas de marketing debería ser PROMOTIONAL (implicaciones
# regulatorias / de enrutamiento). Configurable por env.
MESSAGE_TYPE = os.environ.get('SMS_MESSAGE_TYPE', 'TRANSACTIONAL')


def _mask_phone(phone):
    """Enmascara el celular para no volcar PII completa a CloudWatch."""
    p = str(phone)
    return (p[:4] + '***' + p[-2:]) if len(p) > 6 else '***'


def tenant_key(nit):
    """Llave de tenant (NIT saneado) para la tabla {tenant}_sendStatus del cliente. Igual
    que en Prepare-batch/buckets. Idempotente."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())

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


def _count_sample_send(campaign_id):
    """Cuenta 1 envío de MUESTRA (atómico) en la campaña, SOLO si el envío salió bien.
    Se llama tras un lote de muestras con al menos un SMS enviado (no cuenta si falla)."""
    if not campaign_id:
        return
    try:
        dynamodb.Table('campaign').update_item(
            Key={'campaignId': campaign_id},
            UpdateExpression='SET samplesSentCount = if_not_exists(samplesSentCount, :z) + :one',
            ExpressionAttributeValues={':one': 1, ':z': 0})
    except Exception as e:
        print('No se pudo contar el envío de muestra SMS: {}'.format(e))


def _record_status(tenant, process_id, rows):
    """Inserta los estados de envío en la tabla ÚNICA {tenant}_sendStatus por lotes
    (tenant=tenant_key(NIT)). processId es la PK (una partición por proceso) y sendStatusId la SK."""
    table = dynamodb.Table(f'{tenant}_sendStatus')
    with table.batch_writer() as batch:
        for item in rows:
            item['processId'] = process_id
            batch.put_item(Item=item)


def lambda_handler(event, context):
    now = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

    # Falla ruidosamente si falta la identidad de origen: así SQS RETIENE los
    # mensajes (y los reintenta cuando se configure) en vez de marcar todo el lote
    # como "Rechazado" permanente y borrarlo.
    if not ORIGINATION_IDENTITY:
        raise RuntimeError('SMS_ORIGINATION_IDENTITY no configurada; no se procesa el lote.')

    for record in event.get('Records', []):
        try:
            body = json.loads(record['body'])
        except Exception as e:
            print('Mensaje SQS ilegible: {}'.format(e))
            continue

        customer_name = body.get('customerName', '')
        tenant = tenant_key(body.get('nit', ''))   # llave de {tenant}_sendStatus
        process_id = body.get('processId', '')
        campaign_id = body.get('campaignId', '')
        is_samples = bool(body.get('samples', False))  # muestras → contar si sale bien
        headers = body.get('headers', [])
        sms_body = body.get('smsBody', '') or ''
        data = body.get('data', [])
        print(f'SMS lote: cliente={customer_name} nit={tenant} proceso={process_id} registros={len(data)}')

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
                params = {
                    'DestinationPhoneNumber': phone,
                    'OriginationIdentity': ORIGINATION_IDENTITY,
                    'MessageBody': message,
                    'MessageType': MESSAGE_TYPE,
                    # Metadata que EUM incluye en los eventos de entrega (SNS) para que
                    # ReceptionStatus sepa a qué cliente/proceso pertenece cada estado. `nit`
                    # es la llave (tenant_key) con la que se nombra {tenant}_sendStatus.
                    'Context': {'customer': customer_name, 'nit': tenant, 'processId': process_id, 'uniqueId': unique_id},
                }
                if CONFIGURATION_SET:
                    params['ConfigurationSetName'] = CONFIGURATION_SET
                resp = sms.send_text_message(**params)
                message_id = resp.get('MessageId', message_id)
            except (ClientError, Exception) as e:
                state = STATE_REJECTED
                error = str(e)
                print(f'Fallo SMS a {_mask_phone(phone)}: {error}')

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

        if status_rows and process_id and tenant:
            try:
                _record_status(tenant, process_id, status_rows)
            except Exception as e:
                print('No se pudieron registrar los estados SMS: {}'.format(e))

        # Muestras: si al menos un SMS del lote se envió OK, contar 1 en la campaña.
        if is_samples and any(r.get('state') == STATE_SENT for r in status_rows):
            _count_sample_send(campaign_id)

    return {'statusCode': 200, 'body': json.dumps('SMS batch procesado')}
