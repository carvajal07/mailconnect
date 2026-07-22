'''
Lambda de envío de WhatsApp en lotes (canal WSP).

Trigger: cola SQS `Wsp_Send-batch` (la llena Api_V1_Email_Prepare-batch-template para
campañas con channel="WSP", mismo patrón que email/SMS).

Envía cada mensaje con AWS End User Messaging Social (WhatsApp Business Platform):
cliente boto3 `socialmessaging` → `send_whatsapp_message`. WhatsApp de marketing exige
una PLANTILLA (HSM) pre-aprobada por Meta; el campo `template` de la campaña guarda el
NOMBRE de esa plantilla. Los parámetros del cuerpo ({{1}}, {{2}}, …) se toman de las
columnas del CSV desde "Nombre" en adelante (line[2:]): {{1}}=Nombre, {{2}}=opcional 1, …

Registra el estado en {customer}_sendStatus_{proceso} (igual que email/SMS → reportes y
estadísticas funcionan sin cambios).

Estructura de la data (CSV): line = [identificación, CELULAR E.164, nombre, ...opcionales].

Env:
  WSP_ORIGINATION_PHONE_NUMBER_ID  — ID del número de WhatsApp en End User Messaging (obligatorio).
  WSP_TEMPLATE_LANGUAGE            — código de idioma de la plantilla (default 'es').
  WSP_META_API_VERSION             — versión de la Meta API (default 'v20.0').
'''
import os
import re
import json
import uuid
from datetime import datetime

import boto3
from botocore.exceptions import ClientError


def tenant_key(nit):
    """Llave de tenant (NIT saneado) para la tabla {tenant}_sendStatus. Igual que en
    Prepare-batch/buckets. Idempotente."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())

REGION = 'us-east-1'
ORIGINATION_PHONE_NUMBER_ID = os.environ.get('WSP_ORIGINATION_PHONE_NUMBER_ID', '')
TEMPLATE_LANGUAGE = os.environ.get('WSP_TEMPLATE_LANGUAGE', 'es')
META_API_VERSION = os.environ.get('WSP_META_API_VERSION', 'v20.0')


def _mask_phone(phone):
    p = str(phone)
    return (p[:4] + '***' + p[-2:]) if len(p) > 6 else '***'

dynamodb = boto3.resource('dynamodb', region_name=REGION)
social = boto3.client('socialmessaging', region_name=REGION)

STATE_SENT = 1
STATE_REJECTED = 3

# Índice global messageId -> {customer, processId, uniqueId}. WhatsApp es distinto a SMS/Voz:
# los recibos de Meta (entregado/leído) solo traen el messageId, SIN nuestro context. Este
# índice permite que Api_V1_Wsp_ReceptionStatus mapee cada recibo a su cliente/proceso.
MESSAGE_INDEX_TABLE = os.environ.get('WSP_MESSAGE_INDEX', 'messageIndex')
table_index = dynamodb.Table(MESSAGE_INDEX_TABLE)


def build_whatsapp_message(phone, template_name, params):
    """Arma el JSON de mensaje de plantilla (formato WhatsApp Cloud API)."""
    body_params = [{'type': 'text', 'text': str(p)} for p in params if str(p).strip() != '']
    message = {
        'messaging_product': 'whatsapp',
        'to': phone.lstrip('+'),
        'type': 'template',
        'template': {
            'name': template_name,
            'language': {'code': TEMPLATE_LANGUAGE},
        },
    }
    if body_params:
        message['template']['components'] = [{'type': 'body', 'parameters': body_params}]
    return message


def _claim_part(tenant, process_id, part, registers, date, stage='send'):
    """Reclama ATÓMICAMENTE el derecho a procesar (processId, part) en esta ETAPA.

    Clave DETERMINISTA `processId#part#stage` + escritura condicional
    `attribute_not_exists`: la PRIMERA invocación gana (True → debe enviar); una
    redelivery/duplicado de SQS pierde la condición (False → NO reenviar). Cierra la
    ventana que permitía reenviar todo el lote de WhatsApp (mensajes de plantilla que
    cuestan y llegan a personas reales). Fail-open SOLO si falta tenant/processId."""
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
    # Tabla ÚNICA {tenant}_sendStatus (PK processId + SK sendStatusId). tenant=tenant_key(NIT).
    table = dynamodb.Table(f'{tenant}_sendStatus')
    with table.batch_writer() as batch:
        for item in rows:
            item['processId'] = process_id
            batch.put_item(Item=item)


def _index_messages(tenant, customer_name, process_id, index_rows):
    """Guarda messageId -> (nit, processId, uniqueId) para que el ReceptionStatus de
    WhatsApp pueda mapear los recibos de Meta (que solo traen el messageId). `nit` es la
    llave (tenant_key) con la que se nombra {tenant}_sendStatus. Best-effort: si la tabla no
    existe o falla, no rompe el envío (solo no habrá estados de entrega para esos mensajes)."""
    if not index_rows:
        return
    try:
        with table_index.batch_writer() as batch:
            for r in index_rows:
                batch.put_item(Item={
                    'messageId': r['messageId'],
                    'nit': tenant,               # llave de {tenant}_sendStatus (ReceptionStatus)
                    'customer': customer_name,   # informativo (nombre de empresa)
                    'processId': process_id,
                    'uniqueId': r.get('uniqueId', ''),
                    'channel': 'WSP',
                })
    except Exception as e:
        print('No se pudo indexar los messageId de WhatsApp: {}'.format(e))


def lambda_handler(event, context):
    now = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

    if not ORIGINATION_PHONE_NUMBER_ID:
        raise RuntimeError('WSP_ORIGINATION_PHONE_NUMBER_ID no configurada; no se procesa el lote.')

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
        # El nombre de la plantilla HSM viaja en wspTemplate (campo template de la campaña).
        template_name = body.get('wspTemplate') or body.get('templateName', '')
        data = body.get('data', [])
        print(f'WSP lote: cliente={customer_name} nit={tenant} proceso={process_id} parte={part} plantilla={template_name} registros={len(data)}')

        # IDEMPOTENCIA: reclama (processId, part) atómicamente ANTES de enviar. Una redelivery
        # del mismo mensaje se omite → no se reenvían los WhatsApp del lote.
        if not _claim_part(tenant, process_id, part, len(data), now):
            continue


        status_rows = []
        index_rows = []  # messageId -> (customer, proceso) para los recibos de Meta
        for row in data:
            if not isinstance(row, list) or len(row) < 2:
                continue
            unique_id = str(row[0])
            phone = str(row[1]).strip()
            params = row[2:]  # {{1}}=Nombre, {{2}}=opcional 1, ...

            state = STATE_SENT
            message_id = str(uuid.uuid4())
            error = ''
            sent_ok = False
            try:
                if not template_name:
                    raise RuntimeError('La campaña no tiene plantilla de WhatsApp (HSM)')
                message = build_whatsapp_message(phone, template_name, params)
                resp = social.send_whatsapp_message(
                    originationPhoneNumberId=ORIGINATION_PHONE_NUMBER_ID,
                    message=json.dumps(message).encode('utf-8'),
                    metaApiVersion=META_API_VERSION,
                )
                message_id = resp.get('messageId', message_id)
                sent_ok = True
            except (ClientError, Exception) as e:
                state = STATE_REJECTED
                error = str(e)
                print(f'Fallo WhatsApp a {_mask_phone(phone)}: {error}')

            status_rows.append({
                'sendStatusId': str(uuid.uuid4()),
                'messageId': message_id,
                'uniqueId': unique_id,
                'phone': phone,
                'date': now,
                'state': state,
                'type1': 'WSP',
                'type2': error[:250] if error else 'WhatsApp enviado',
            })
            # Solo se indexan los enviados con messageId real de Meta (los que recibirán
            # recibos de entrega/lectura). Los fallidos no generan eventos.
            if sent_ok:
                index_rows.append({'messageId': message_id, 'uniqueId': unique_id})

        if status_rows and process_id and tenant:
            try:
                _record_status(tenant, process_id, status_rows)
            except Exception as e:
                print('No se pudieron registrar los estados WhatsApp: {}'.format(e))
            _index_messages(tenant, customer_name, process_id, index_rows)

        # Parte completada: marca 'Terminado' sobre la fila reclamada (observabilidad).
        _mark_part(tenant, process_id, part, 'Terminado')

        # Muestras: si al menos un mensaje del lote se envió OK, contar 1 en la campaña.
        if is_samples and campaign_id and any(r.get('state') == STATE_SENT for r in status_rows):
            try:
                dynamodb.Table('campaign').update_item(
                    Key={'campaignId': campaign_id},
                    UpdateExpression='SET samplesSentCount = if_not_exists(samplesSentCount, :z) + :one',
                    ExpressionAttributeValues={':one': 1, ':z': 0})
            except Exception as e:
                print('No se pudo contar el envío de muestra WhatsApp: {}'.format(e))

    return {'statusCode': 200, 'body': json.dumps('WhatsApp batch procesado')}
