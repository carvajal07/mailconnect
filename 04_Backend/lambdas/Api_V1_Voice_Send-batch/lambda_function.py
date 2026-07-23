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


def tenant_key(nit):
    """Llave de tenant (NIT saneado) para la tabla {tenant}_sendStatus del cliente. Igual
    que en Prepare-batch/buckets. Idempotente."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())

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


def _claim_part(tenant, process_id, part, registers, date, stage='send'):
    """Reclama ATÓMICAMENTE el derecho a procesar (processId, part) en esta ETAPA.

    Clave DETERMINISTA `processId#part#stage` + escritura condicional
    `attribute_not_exists`: la PRIMERA invocación gana (True → debe llamar); una
    redelivery/duplicado de SQS pierde la condición (False → NO rellamar). Cierra la
    ventana que permitía repetir todo el lote de llamadas (una llamada duplicada suena en
    el teléfono de una persona real y cuesta). Fail-open SOLO si falta tenant/processId."""
    if not tenant or not process_id or part is None:
        return True
    table = dynamodb.Table(f'{tenant}_processDetail')
    detail_id = f'{process_id}#{part}#{stage}'
    try:
        table.put_item(
            Item={'processDetailId': detail_id, 'processId': process_id, 'part': part,
                  'registers': registers, 'date': date, 'stateProcess': 'Procesando', 'stage': stage},
            ConditionExpression='attribute_not_exists(processDetailId)')
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            print(f'Parte {part} del proceso {process_id} ya reclamada ({stage}); se omite (duplicado SQS).')
            return False
        raise


def _mark_part(tenant, process_id, part, state, stage='send'):
    """Marca el estado final de (processId, part, stage) sobre la MISMA fila determinista.
    Best-effort."""
    if not tenant or not process_id or part is None:
        return
    try:
        dynamodb.Table(f'{tenant}_processDetail').update_item(
            Key={'processDetailId': f'{process_id}#{part}#{stage}'},
            UpdateExpression='SET stateProcess = :s',
            ExpressionAttributeValues={':s': state})
    except Exception as e:
        print(f'No se pudo marcar la parte {part} como {state}: {e}')


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

    if not ORIGINATION_IDENTITY:
        raise RuntimeError('VOICE_ORIGINATION_IDENTITY no configurada; no se procesa el lote.')

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
        part = body.get('part')                    # id de sub-lote ÚNICO en el proceso (idempotencia)
        is_samples = bool(body.get('samples', False))  # muestras → contar si sale bien
        headers = body.get('headers', [])
        voice_message = body.get('voiceMessage', '') or ''
        data = body.get('data', [])
        print(f'VOZ lote: cliente={customer_name} nit={tenant} proceso={process_id} parte={part} registros={len(data)}')

        # IDEMPOTENCIA: reclama (processId, part) atómicamente ANTES de llamar. Una redelivery
        # del mismo mensaje se omite → no se repiten las llamadas (dinero + robocall duplicado).
        if not _claim_part(tenant, process_id, part, len(data), now):
            continue


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
                    # ReceptionStatus sepa a qué cliente/proceso pertenece cada estado. `nit`
                    # es la llave (tenant_key) con la que se nombra {tenant}_sendStatus.
                    'Context': {'customer': customer_name, 'nit': tenant, 'processId': process_id, 'uniqueId': unique_id},
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

        if status_rows and process_id and tenant:
            try:
                _record_status(tenant, process_id, status_rows)
            except Exception as e:
                print('No se pudieron registrar los estados de voz: {}'.format(e))

        # Parte completada: marca 'Terminado' sobre la fila reclamada (observabilidad).
        _mark_part(tenant, process_id, part, 'Terminado')

        # Muestras: si al menos una llamada del lote se realizó OK, contar 1 en la campaña.
        if is_samples and campaign_id and any(r.get('state') == STATE_SENT for r in status_rows):
            try:
                dynamodb.Table('campaign').update_item(
                    Key={'campaignId': campaign_id},
                    UpdateExpression='SET samplesSentCount = if_not_exists(samplesSentCount, :z) + :one',
                    ExpressionAttributeValues={':one': 1, ':z': 0})
            except Exception as e:
                print('No se pudo contar el envío de muestra de voz: {}'.format(e))

    return {'statusCode': 200, 'body': json.dumps('Voice batch procesado')}
