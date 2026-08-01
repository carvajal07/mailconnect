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
ORIGINATION_IDENTITY = os.environ.get('SMS_ORIGINATION_IDENTITY', '').strip()

# ── Proveedores alternos (ruteo por providerConfig, campo `provider` del mensaje) ─────
# Credenciales de PLATAFORMA por env var. Los adaptadores usan urllib (stdlib): sumar un
# SDK por proveedor obligaría a un layer por worker. Helper COPIADO por lambda, como
# `tenant_key` (convención del repo, sin imports compartidos).
import base64 as _b64
import urllib.error
import urllib.parse
import urllib.request

TWILIO_ACCOUNT_SID = os.environ.get('TWILIO_ACCOUNT_SID', '').strip()
TWILIO_AUTH_TOKEN = os.environ.get('TWILIO_AUTH_TOKEN', '').strip()
# Número E.164 o Messaging Service SID (MG…) de Twilio para SMS.
TWILIO_FROM_SMS = os.environ.get('TWILIO_FROM_SMS', '').strip()
INFOBIP_BASE_URL = os.environ.get('INFOBIP_BASE_URL', '').strip()
INFOBIP_API_KEY = os.environ.get('INFOBIP_API_KEY', '').strip()
INFOBIP_FROM_SMS = os.environ.get('INFOBIP_FROM_SMS', '').strip()


def _check_provider_config(provider):
    """Valida ANTES de reclamar la parte que el proveedor elegido tenga credenciales.

    ⚠️ Lanza (el lote FALLA y SQS lo reintenta) en vez de marcar destinatarios como
    rechazados: un error de CONFIGURACIÓN es idéntico para todo el lote y no se intentó
    ningún envío — quemar la parte con estados falsos ensuciaría los reportes y perdería
    el lote sin posibilidad de reintento. Debe correr ANTES de `_claim_part`: después del
    claim, la redelivery vería la parte reclamada y la omitiría.
    """
    if provider == 'aws':
        if not ORIGINATION_IDENTITY:
            raise RuntimeError('SMS_ORIGINATION_IDENTITY no configurada; no se procesa el lote.')
    elif provider == 'twilio':
        if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_FROM_SMS):
            raise RuntimeError('Proveedor twilio elegido pero faltan credenciales '
                               '(TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_SMS); no se procesa el lote.')
    elif provider == 'infobip':
        if not (INFOBIP_BASE_URL and INFOBIP_API_KEY and INFOBIP_FROM_SMS):
            raise RuntimeError('Proveedor infobip elegido pero faltan credenciales '
                               '(INFOBIP_BASE_URL/INFOBIP_API_KEY/INFOBIP_FROM_SMS); no se procesa el lote.')
    else:
        raise RuntimeError('Proveedor de SMS desconocido: {!r}; no se procesa el lote.'.format(provider))


def _http_json(req):
    """POST y respuesta JSON; los 4xx/5xx llevan el cuerpo del proveedor al error (sin
    eso, diagnosticar un rechazo sería adivinar)."""
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        cuerpo = ''
        try:
            cuerpo = e.read().decode('utf-8')[:300]
        except Exception:
            pass
        raise RuntimeError('HTTP {} del proveedor: {}'.format(e.code, cuerpo))


def _send_sms_twilio(phone, body_text):
    """Envía por la API de mensajes de Twilio. Devuelve el sid como messageId."""
    url = 'https://api.twilio.com/2010-04-01/Accounts/{}/Messages.json'.format(TWILIO_ACCOUNT_SID)
    campos = {'To': phone, 'Body': body_text}
    # Un Messaging Service (MG…) va en su propio campo; un número, en From.
    if TWILIO_FROM_SMS.startswith('MG'):
        campos['MessagingServiceSid'] = TWILIO_FROM_SMS
    else:
        campos['From'] = TWILIO_FROM_SMS
    req = urllib.request.Request(url, data=urllib.parse.urlencode(campos).encode(), method='POST')
    aut = _b64.b64encode('{}:{}'.format(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN).encode()).decode()
    req.add_header('Authorization', 'Basic ' + aut)
    out = _http_json(req)
    sid = out.get('sid')
    if not sid:
        raise RuntimeError('Twilio no devolvió sid: {}'.format(str(out)[:200]))
    return sid


def _send_sms_infobip(phone, body_text):
    """Envía por la API SMS de Infobip. Devuelve su messageId."""
    url = INFOBIP_BASE_URL.rstrip('/') + '/sms/2/text/advanced'
    payload = {'messages': [{'destinations': [{'to': phone}],
                             'from': INFOBIP_FROM_SMS, 'text': body_text}]}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST')
    req.add_header('Authorization', 'App ' + INFOBIP_API_KEY)
    req.add_header('Content-Type', 'application/json')
    out = _http_json(req)
    msg = (out.get('messages') or [{}])[0]
    # groupId 1 = PENDING (aceptado); un rechazo inmediato viene con otro grupo.
    grupo = ((msg.get('status') or {}).get('groupId'))
    if grupo not in (1, 3):
        raise RuntimeError('Infobip rechazó el SMS: {}'.format(str(msg.get('status'))[:200]))
    return str(msg.get('messageId') or '')
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


def _claim_part(tenant, process_id, part, registers, date, stage='send'):
    """Reclama ATÓMICAMENTE el derecho a procesar (processId, part) en esta ETAPA.

    Clave DETERMINISTA `processId#part#stage` + escritura condicional
    `attribute_not_exists`: la PRIMERA invocación gana (True → debe enviar); una
    redelivery/duplicado de SQS (entrega at-least-once, o vencimiento del visibility
    timeout en un lote lento) pierde la condición (False → NO reenviar). Cierra la
    ventana de carrera que permitía enviar dos veces el mismo lote de SMS (que cuesta
    dinero real por mensaje). `stage` separa la etapa de combinación de la de envío en
    el flujo EAP; aquí siempre 'send'.

    Fail-open SOLO si falta tenant/processId (no se puede deduplicar): procesa, como
    antes. La tabla {tenant}_processDetail la crea Prepare-batch en el setup del proceso."""
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
    """Marca el estado final de (processId, part, stage) sobre la MISMA fila determinista
    que reclamó _claim_part. Best-effort (no rompe el envío ya realizado)."""
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

    # La validación de configuración pasó a `_check_provider_config`, POR MENSAJE:
    # cada lote trae su proveedor (aws/twilio/infobip) y solo debe exigirse la
    # credencial del que de verdad se va a usar.
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
        sms_body = body.get('smsBody', '') or ''
        data = body.get('data', [])
        # Proveedor elegido por el admin para este cliente/canal (mensajes viejos → aws).
        provider = str(body.get('provider') or 'aws').strip().lower()
        print(f'SMS lote: cliente={customer_name} nit={tenant} proceso={process_id} parte={part} registros={len(data)} proveedor={provider}')
        # ⚠️ ANTES del claim: si falta la credencial, el lote falla y SQS reintenta.
        _check_provider_config(provider)

        # IDEMPOTENCIA: reclama (processId, part) de forma atómica ANTES de enviar. Si otra
        # entrega del mismo mensaje ya lo reclamó (redelivery de SQS), se omite el lote → no
        # se reenvían SMS (cada SMS cuesta y un duplicado llega al celular de una persona real).
        if not _claim_part(tenant, process_id, part, len(data), now):
            continue

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
                if provider == 'twilio':
                    # ⚠️ Sin webhook de entrega todavía: el estado queda en 1 (enviado).
                    message_id = _send_sms_twilio(phone, message)
                elif provider == 'infobip':
                    message_id = _send_sms_infobip(phone, message)
                else:
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

        # Parte completada: marca 'Terminado' sobre la fila reclamada (observabilidad).
        _mark_part(tenant, process_id, part, 'Terminado')

        # Muestras: si al menos un SMS del lote se envió OK, contar 1 en la campaña.
        if is_samples and any(r.get('state') == STATE_SENT for r in status_rows):
            _count_sample_send(campaign_id)

    return {'statusCode': 200, 'body': json.dumps('SMS batch procesado')}
