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

# ── Proveedor alterno TWILIO (ruteo por providerConfig, campo `provider` del mensaje) ──
# Con numeración local o mejor cobertura hacia +57 que un número de AWS EUM (que solo
# vende numeración de EE. UU.). Credenciales de PLATAFORMA por env var; urllib de la
# stdlib (sin layers). Helper COPIADO por lambda, como `tenant_key`.
import base64 as _b64
import urllib.error
import urllib.parse
import urllib.request
from xml.sax.saxutils import escape as _xml_escape

TWILIO_ACCOUNT_SID = os.environ.get('TWILIO_ACCOUNT_SID', '').strip()
TWILIO_AUTH_TOKEN = os.environ.get('TWILIO_AUTH_TOKEN', '').strip()
TWILIO_FROM_VOICE = os.environ.get('TWILIO_FROM_VOICE', '').strip()  # número E.164 con voz
# Voz Polly que Twilio usa para leer el texto (es-MX/es-US disponibles en su catálogo).
TWILIO_VOICE = os.environ.get('TWILIO_VOICE', 'Polly.Lupe')


def _check_provider_config(provider):
    """Valida ANTES de reclamar la parte que el proveedor elegido tenga credenciales.

    ⚠️ Lanza (el lote FALLA y SQS reintenta) en vez de marcar destinatarios rechazados:
    un error de configuración es idéntico para todo el lote y no se intentó ninguna
    llamada — es exactamente el caso del `originationIdentity` inválido que marcaba a
    todos como rechazados. Debe correr ANTES de `_claim_part`.
    """
    if provider == 'aws':
        if not ORIGINATION_IDENTITY:
            raise RuntimeError('VOICE_ORIGINATION_IDENTITY no configurada; no se procesa el lote.')
    elif provider == 'twilio':
        if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_FROM_VOICE):
            raise RuntimeError('Proveedor twilio elegido pero faltan credenciales '
                               '(TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_VOICE); no se procesa el lote.')
    else:
        raise RuntimeError('Proveedor de VOZ desconocido: {!r}; no se procesa el lote.'.format(provider))


def _send_voice_twilio(phone, text):
    """Origina la llamada por la API de Twilio con TwiML `<Say>` (TTS de Polly).
    Devuelve el sid de la llamada como messageId."""
    url = 'https://api.twilio.com/2010-04-01/Accounts/{}/Calls.json'.format(TWILIO_ACCOUNT_SID)
    # En TEXT el contenido se escapa (es texto plano dentro de XML). En SSML ya ES
    # markup y se pasa tal cual — escaparlo leería las etiquetas en voz alta.
    contenido = text if BODY_TEXT_TYPE == 'SSML' else _xml_escape(text)
    twiml = '<Response><Say voice="{}" language="es-MX">{}</Say></Response>'.format(
        TWILIO_VOICE, contenido)
    campos = {'To': phone, 'From': TWILIO_FROM_VOICE, 'Twiml': twiml}
    req = urllib.request.Request(url, data=urllib.parse.urlencode(campos).encode(), method='POST')
    aut = _b64.b64encode('{}:{}'.format(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN).encode()).decode()
    req.add_header('Authorization', 'Basic ' + aut)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            out = json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        cuerpo = ''
        try:
            cuerpo = e.read().decode('utf-8')[:300]
        except Exception:
            pass
        raise RuntimeError('Twilio HTTP {}: {}'.format(e.code, cuerpo))
    sid = out.get('sid')
    if not sid:
        raise RuntimeError('Twilio no devolvió sid: {}'.format(str(out)[:200]))
    return sid


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

    # La validación de configuración es POR MENSAJE (`_check_provider_config`): cada
    # lote trae su proveedor y solo se exige la credencial del que se va a usar.

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
        # Proveedor elegido por el admin para este cliente/canal (mensajes viejos → aws).
        provider = str(body.get('provider') or 'aws').strip().lower()
        # ⚠️ ANTES del claim: si falta la credencial, el lote falla y SQS reintenta.
        _check_provider_config(provider)
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
                if provider == 'twilio':
                    # ⚠️ Sin webhook de estado todavía: queda en 1 (llamada iniciada).
                    message_id = _send_voice_twilio(phone, message)
                else:
                    params = {
                        'DestinationPhoneNumber': phone,
                        'OriginationIdentity': ORIGINATION_IDENTITY,
                        'MessageBody': message,
                        'MessageBodyTextType': BODY_TEXT_TYPE,
                        'VoiceId': VOICE_ID,
                        # Metadata que EUM incluye en los eventos de la llamada (SNS) para
                        # que ReceptionStatus sepa a qué cliente/proceso pertenece cada
                        # estado. `nit` = tenant_key que nombra {tenant}_sendStatus.
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
