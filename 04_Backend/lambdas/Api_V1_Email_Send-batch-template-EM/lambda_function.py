'''
Lambda para realizar el envio de emails en lotes (Email marketing)
'''
import os
import re
import json
import hmac
import uuid
import base64
import hashlib
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

#pylint: disable=C0301
#pylint: disable=W0604
#C0301 -> line too long
REGION = 'us-east-1'
QUANTITY_BATCH = 50

# Desuscripción: URL pública de la lambda Unsubscribe y clave para firmar el token.
# El builder agrega al pie de cada plantilla un enlace con la variable
# {{unsubscribeUrl}}; aquí se llena por destinatario. Enviar el dato SIEMPRE es
# seguro: si la plantilla no usa la variable, SES ignora el campo extra.
UNSUBSCRIBE_URL = os.environ.get('UNSUBSCRIBE_URL', 'https://api.mailconnect.com.co/V1/Email/Unsubscribe')
# Centro de PREFERENCIAS (Bloque H): mismo token firmado que el unsubscribe. La variable
# {{preferencesUrl}} la puede usar el pie de la plantilla ("administrar preferencias").
PREFERENCES_URL = os.environ.get('PREFERENCES_URL', 'https://api.mailconnect.com.co/V1/Email/Preferences')
SECRET_KEY = os.environ.get('SECRET_KEY', '')


def tenant_key(nit):
    """Llave de tenant (NIT saneado) para las tablas por cliente ({tenant}_sendDetail,
    _processDetail). Igual que en Prepare-batch y en los buckets S3. Idempotente."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def build_unsubscribe_url(customer, email, tenant=''):
    """Token firmado (HMAC-SHA256) que la lambda Unsubscribe valida. `tenant` (llave por
    NIT) viaja como 'n' para que Unsubscribe nombre la tabla {tenant}_unsubscribe (misma
    llave con la que Prepare-batch creó la tabla)."""
    payload = json.dumps({'c': customer, 'e': email, 'n': tenant}, separators=(',', ':'))
    payload_b64 = base64.urlsafe_b64encode(payload.encode()).decode().rstrip('=')
    signature = hmac.new(SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{UNSUBSCRIBE_URL}?t={payload_b64}.{signature}"


def build_preferences_url(customer, email, tenant=''):
    """Token firmado (mismo esquema del unsubscribe) que abre el CENTRO DE PREFERENCIAS."""
    payload = json.dumps({'c': customer, 'e': email, 'n': tenant}, separators=(',', ':'))
    payload_b64 = base64.urlsafe_b64encode(payload.encode()).decode().rstrip('=')
    signature = hmac.new(SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{PREFERENCES_URL}?t={payload_b64}.{signature}"

global customer_name
global tenant
global template_name
global from_email
global process_detail_id
global process_id
global configuration_set

# Config set SES por defecto (pool GENERAL). El mensaje SQS trae el del cliente
# (configurationSet, resuelto por Prepare-batch desde sendingConfig → IP dedicada).
DEFAULT_CONFIGURATION_SET = os.environ.get('SES_CONFIGURATION_SET', 'default')
configuration_set = DEFAULT_CONFIGURATION_SET

# ── Proveedor alterno SOCKETLABS (ruteo por providerConfig, campo `provider`) ─────────
# SES resuelve la plantilla EN SU SERVIDOR ({{var}} vía ReplacementTemplateData); un
# proveedor externo no la conoce, así que este camino la BAJA de SES (get_template) y la
# renderiza LOCALMENTE por destinatario antes de inyectar. urllib de la stdlib (sin
# layers). Credenciales de PLATAFORMA por env var.
import urllib.error
import urllib.request

provider = 'aws'   # global legado (mismo patrón que configuration_set); el mensaje lo pisa
SOCKETLABS_SERVER_ID = os.environ.get('SOCKETLABS_SERVER_ID', '').strip()
SOCKETLABS_API_KEY = os.environ.get('SOCKETLABS_API_KEY', '').strip()
SOCKETLABS_INJECT_URL = os.environ.get(
    'SOCKETLABS_INJECT_URL', 'https://inject.socketlabs.com/api/v1/email').strip()

# Cache por invocación de la plantilla bajada de SES (un lote usa UNA plantilla).
_TEMPLATE_CACHE = {}


def _check_provider_config(prov):
    """⚠️ ANTES de reclamar chunks: si el proveedor elegido no tiene credenciales, el
    lote FALLA (SQS reintenta) en vez de quemar destinatarios con estados falsos."""
    if prov == 'socketlabs' and not (SOCKETLABS_SERVER_ID and SOCKETLABS_API_KEY):
        raise RuntimeError('Proveedor socketlabs elegido pero faltan credenciales '
                           '(SOCKETLABS_SERVER_ID/SOCKETLABS_API_KEY); no se procesa el lote.')
    if prov not in ('aws', 'socketlabs'):
        raise RuntimeError('Proveedor de EMAIL desconocido: {!r}; no se procesa el lote.'.format(prov))


_IF_RE = re.compile(r'\{\{#if\s+([\w.]+)\s*\}\}(.*?)(?:\{\{else\}\}(.*?))?\{\{/if\}\}', re.S)


def _render_ses_template(texto, datos):
    """Réplica LOCAL de la sustitución que SES hace en su servidor: `{{campo}}` y la forma
    condicional `{{#if campo}}…{{else}}…{{/if}}` (la que emite el menú de variables con
    respaldo del constructor). Debe comportarse IGUAL que SES: campo ausente → vacío."""
    def _cond(m):
        valor = str(datos.get(m.group(1)) or '')
        return m.group(2) if valor.strip() else (m.group(3) or '')
    salida = _IF_RE.sub(_cond, texto or '')
    return re.sub(r'\{\{\s*([\w.]+)\s*\}\}',
                  lambda m: str(datos.get(m.group(1)) or ''), salida)


def _ses_template_parts(nombre):
    if nombre not in _TEMPLATE_CACHE:
        t = ses.get_template(TemplateName=nombre)['Template']
        _TEMPLATE_CACHE[nombre] = (t.get('SubjectPart') or '', t.get('HtmlPart') or '',
                                   t.get('TextPart') or '')
    return _TEMPLATE_CACHE[nombre]


def _send_bulk_socketlabs(destinations, remitente, nombre_plantilla):
    """Inyecta el chunk por SocketLabs y devuelve la respuesta con la MISMA forma que
    `send_bulk_templated_email` ({'Status': [...]}) para no tocar el registro de estados.

    Un fallo del REQUEST completo se relanza: el chunk libera su claim y SQS lo reanuda
    (mismo contrato que el camino SES).
    """
    asunto, html, texto = _ses_template_parts(nombre_plantilla)
    mensajes = []
    for d in destinations:
        datos = json.loads(d.get('ReplacementTemplateData') or '{}')
        mensajes.append({
            'To': [{'EmailAddress': d['Destination']['ToAddresses'][0]}],
            'From': {'EmailAddress': remitente},
            'Subject': _render_ses_template(asunto, datos),
            'HtmlBody': _render_ses_template(html, datos),
            'TextBody': _render_ses_template(texto, datos),
        })
    cuerpo = {'ServerId': int(SOCKETLABS_SERVER_ID), 'ApiKey': SOCKETLABS_API_KEY,
              'Messages': mensajes}
    req = urllib.request.Request(SOCKETLABS_INJECT_URL, data=json.dumps(cuerpo).encode(),
                                 method='POST')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            out = json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        detalle = ''
        try:
            detalle = e.read().decode('utf-8')[:300]
        except Exception:
            pass
        raise RuntimeError('SocketLabs HTTP {}: {}'.format(e.code, detalle))

    codigo = str(out.get('ErrorCode') or '')
    if codigo == 'Success':
        return {'Status': [{'Status': 'Success', 'MessageId': str(uuid.uuid4())}
                           for _ in mensajes]}
    if codigo == 'Warning':
        # Con Warning el request entró pero algunos mensajes fallaron: MessageResults trae
        # el índice y el error de cada uno; los demás salieron bien.
        malos = {int(m.get('Index', -1)): str(m.get('ErrorCode') or 'Failed')
                 for m in (out.get('MessageResults') or [])}
        return {'Status': [
            ({'Status': 'Failed', 'Error': malos[i]} if i in malos
             else {'Status': 'Success', 'MessageId': str(uuid.uuid4())})
            for i in range(len(mensajes))]}
    # Error total (credenciales, servidor): nada salió → relanzar para reintentar.
    raise RuntimeError('SocketLabs rechazó el lote: {}'.format(str(out)[:300]))

#Separar librerias
#poner primero las variables estaticas
#nombrar bien las variables
#Docstring para las funciones
#tipado para las variables

#Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')
dynamo = boto3.client('dynamodb')

#Crea un cliente de SES
ses = boto3.client('ses', region_name=REGION)

table_document = dynamodb.Table('document')
table_campaign = dynamodb.Table('campaign')

def validate_process_detail(part:int)->dict:
    """
    Función encargada de validar el estado de cada parte en la tabla de los detalles.

    Args:
        part (int): Indice de la parte a validar
        
    Returns:
        dict: Informacion de la parte
    """

    table_process_detail = dynamodb.Table(f'{tenant}_processDetail')
    projection_campaign_expression = 'stateProcess, processDetailId'  # Lista de campos a consultar

    response_process_detail = table_process_detail.scan(
        FilterExpression="processId = :value1 and part = :value2",
        ExpressionAttributeValues={":value1": process_id,":value2": part},
        ProjectionExpression=projection_campaign_expression
    )
    return response_process_detail

def insert_process_detail(registers:int,part:int,date:str,state:str)->None:
    """
    Función encargada de insertar los detalles de cada parte a la base de datos con su respectivo estado.

    Args:
        registers (int): Cantidad de registros a enviar
        part (int): Indice de la parte
        date (str): Fecha de procesamiento
        state (str): Estado del proceso
        
    Returns:
        None: No retorna resultados
    """   

    table_process_detail = dynamodb.Table(f'{tenant}_processDetail')

    # Insertar datos en la tabla de detalle de procesos
    table_process_detail.put_item(
        Item={
            'processDetailId': process_detail_id,
            'processId': process_id,
            'registers': registers,
            'part': part,
            'date': date,
            'stateProcess': state
        }
    )

def _claim_part(tenant_key_value:str, process_id_value:str, part:int, registers:int, date:str, stage:str='send')->bool:
    """Reclama ATÓMICAMENTE el derecho a enviar (processId, part) para esta ETAPA.

    Reemplaza el patrón anterior validate_process_detail(scan) + insert_process_detail(put con
    uuid ALEATORIO), que NO era atómico: dos entregas concurrentes del mismo mensaje SQS
    (entrega at-least-once, o vencimiento del visibility timeout en un lote grande) hacían el
    scan (ninguna veía nada) y ambas hacían put con uuid distinto → el lote se enviaba DOS
    veces. Además el scan leía solo la primera página de 1 MB y a escala podía no encontrar la
    fila. Aquí la clave es DETERMINISTA (`processId#part#stage`) y la escritura condicional
    `attribute_not_exists`: solo la PRIMERA invocación gana (True → envía); la redelivery pierde
    la condición (False → NO reenvía). Fail-open SOLO si falta la llave de tenant/proceso."""
    if not tenant_key_value or not process_id_value or part is None:
        return True
    table = dynamodb.Table(f'{tenant_key_value}_processDetail')
    detail_id = f'{process_id_value}#{part}#{stage}'
    try:
        table.put_item(
            Item={'processDetailId': detail_id, 'processId': process_id_value, 'part': part,
                  'registers': registers, 'date': date, 'stateProcess': 'Procesando', 'stage': stage},
            ConditionExpression='attribute_not_exists(processDetailId)')
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise


def _mark_part(tenant_key_value:str, process_id_value:str, part:int, state:str, stage:str='send')->None:
    """Marca el estado final de (processId, part, stage) sobre la MISMA fila determinista que
    reclamó _claim_part. Best-effort (el envío ya se hizo; no se revierte por esto)."""
    if not tenant_key_value or not process_id_value or part is None:
        return
    try:
        dynamodb.Table(f'{tenant_key_value}_processDetail').update_item(
            Key={'processDetailId': f'{process_id_value}#{part}#{stage}'},
            UpdateExpression='SET stateProcess = :s',
            ExpressionAttributeValues={':s': state})
    except Exception as e:
        print(f'No se pudo marcar la parte {part} como {state}: {e}')


def _release_part(tenant_key_value:str, process_id_value:str, part:int, stage:str='send')->None:
    """Libera (borra) el claim de un chunk cuyo envío FALLÓ, para que una redelivery lo
    REINTENTE. Se usa cuando la llamada a SES lanza excepción (no entregó nada): sin liberar, el
    chunk quedaría reclamado y la reanudación lo saltaría → pérdida. Best-effort."""
    if not tenant_key_value or not process_id_value or part is None:
        return
    try:
        dynamodb.Table(f'{tenant_key_value}_processDetail').delete_item(
            Key={'processDetailId': f'{process_id_value}#{part}#{stage}'})
    except Exception as e:
        print(f'No se pudo liberar el claim del chunk {stage} de la parte {part}: {e}')


def insert_send_detail(data:dict)->None:
    """
    Función encargada de insertar los detalles de cada envio a la base de datos.

    Args:
        data (dict): Diccionario con la información de los detalles para insertar
        
    Returns:
        None: No retorna resultados
    """

    # Tabla ÚNICA de detalle del cliente (PK processId + SK sendDetailId).
    table_name = f'{tenant}_sendDetail'
    table_send_detail = dynamodb.Table(table_name)


    response = dynamo.batch_write_item(
        RequestItems={
            table_name: [
                {'PutRequest': {'Item': item}} for item in data
            ]
        }
    )
    print(response)

    # Verifica si hubo errores en la inserción
    if response.get('UnprocessedItems'):
        print('Hubo elementos no procesados:', response['UnprocessedItems'])
        response = dynamo.batch_write_item(
            RequestItems={table_name: response['UnprocessedItems'][table_name]}
        )
    else:
        print('Todos los elementos se insertaron correctamente.')


    
    '''
    # Realiza la inserción en lotes utilizando el método batch_write_item
    with dynamo.batch_write_item(RequestItems={table_name: [{'PutRequest': {'Item': item}} for item in data]}) as response:
        pass  # La inserción se realiza en el bloque 'with'
    
    print(response)
    # Verifica si hubo errores en la inserción
    if response.get('UnprocessedItems'):
        print('Hubo elementos no procesados:', response['UnprocessedItems'])
    else:
        print('Todos los elementos se insertaron correctamente.')

    '''

def send_bulk(data:list, headers:list, start:int, end:int, default_tags:dict)->None:
    """
    Esta función realiza el envio de bulk de paquetes maximo de 50 registros.

    Args:
        data (list): Lista con los datos de todos los registros que se van a enviar
        headers (list): Lista con los emcabezados del csv, estos son las llaves para la personalizacion del email
        start (int): Indica desde que registro se debe tomar para el envio
        end (int): Indica hasta que registro se debe tomar para el envio
        default_tags (dic): Diccionario con la informacion de tags, aca se envia la informacion del customer, id de campaña y id del proceso

    Returns:
        None: No retorna resultados
    """
    destinations = []
    emails = []
    unique_ids = []
    data_to_insert = []
    for register in data[start:end]:
        #data_list = register.split(";")
        unique_id = register[0]
        email = register[1]
        emails.append(email)
        unique_ids.append(unique_id)
        #print(email)
        json_dict = dict(zip(headers,register))
        # Enlace de desuscripción por destinatario (variable {{unsubscribeUrl}}).
        json_dict['unsubscribeUrl'] = build_unsubscribe_url(customer_name, email, tenant)
        # Enlace al centro de preferencias (variable {{preferencesUrl}}); si la plantilla
        # no lo usa, SES ignora el campo extra sin error.
        json_dict['preferencesUrl'] = build_preferences_url(customer_name, email, tenant)
        json_string = json.dumps(json_dict)
        destinations.append({
            "Destination":{"ToAddresses": [email]},
            "ReplacementTemplateData": 
                json_string
        })

    print("Finaliza proceso de personalizacion de data")
    # Obtener la fecha y hora actual
    now = datetime.utcnow()
    # Formatear la fecha y hora según un formato específico
    formatted_date = now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + 'Z'
    # Envía el lote de correos electrónicos
    #Maximo 50 destinatarios o envios de email
    print("Ejecutando proceso de envio del bulk")
    if provider == 'socketlabs':
        # ⚠️ Sin los eventos SNS de SES: aperturas/clics/rebotes de este camino llegan por
        # el webhook del proveedor (pendiente); el estado queda en 'enviado'.
        response = _send_bulk_socketlabs(destinations, from_email, template_name)
    else:
        response = ses.send_bulk_templated_email(
            Source=from_email,
            Template=template_name,
            ConfigurationSetName=configuration_set,
            Destinations=destinations,
            DefaultTags=default_tags,
            DefaultTemplateData='{}'
        )
    print("Proceso de envio de bulk finalizado")
    #'Status':
    '''
    'Success'
    'MessageRejected'
    'MailFromDomainNotVerified'
    'ConfigurationSetDoesNotExist'
    'TemplateDoesNotExist'
    'AccountSuspended'
    'AccountThrottled'
    'AccountDailyQuotaExceeded'
    'InvalidSendingPoolName'
    'AccountSendingPaused'
    'ConfigurationSetSendingPaused'
    'InvalidParameterValue'
    'TransientFailure'
    'Failed'
    '''
    print("Iniciando proceso de registro de estados")
    indice_registros = 0
    for record in response['Status']:
        email = emails[indice_registros]
        #print(email)
        unique_id = unique_ids[indice_registros]
        #print(unique_id)
        data_string = str(data[indice_registros])
        #print(data_string)
        state = record['Status']
        #print(state)
        send_detail_id = record.get('MessageId', str(uuid.uuid4())+"-Error")
        error = record.get('Error', '')

        # Define los datos que deseas insertar (processId = PK de la tabla única).
        data_to_insert.append({
            'processId': {'S': process_id},
            'sendDetailId': {'S': send_detail_id},
            'processDetailId': {'S': process_detail_id},
            'uniqueId': {'S': unique_id},
            'email': {'S': email},
            'data': {'S': data_string},
            'date': {'S': formatted_date}
        })
        indice_registros += 1

    #Aca debo insertar los errores que se pudieran presentar
    print("Insertar informacion en la tabla")
    insert_send_detail(data_to_insert)
    print("Fin de proceso de insert de estados")

def note_sample_result(campaign_id:str, ok:bool, reason:str='')->None:
    """Registra en la campaña el resultado del último envío de MUESTRA.

    OK    -> suma 1 a `samplesSentCount` (el cupo se consume solo cuando la muestra SALE)
             y BORRA el aviso de fallo anterior: si el reintento de SQS terminó bien, el
             cliente no puede seguir viendo un error que ya no existe.
    FALLO -> escribe `lastSampleError`/`lastSampleErrorAt` SIN tocar el contador. Es lo
             UNICO que el portal puede mostrar: el envío es asíncrono, así que sin esta
             marca un fallo se ve EXACTAMENTE igual que "todavía va en camino" y el
             usuario se queda esperando un correo que nunca va a llegar.

    Best-effort en ambos casos: dejar constancia no puede tumbar un envío ya hecho.
    """
    if not campaign_id:
        return
    ahora = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    try:
        if ok:
            dynamodb.Table('campaign').update_item(
                Key={'campaignId': campaign_id},
                UpdateExpression=('SET samplesSentCount = if_not_exists(samplesSentCount, :z) + :one, '
                                  'lastSampleAt = :at REMOVE lastSampleError, lastSampleErrorAt'),
                ExpressionAttributeValues={':one': 1, ':z': 0, ':at': ahora})
        else:
            dynamodb.Table('campaign').update_item(
                Key={'campaignId': campaign_id},
                UpdateExpression='SET lastSampleError = :e, lastSampleErrorAt = :at',
                ExpressionAttributeValues={':e': str(reason)[:300] or 'Error desconocido', ':at': ahora})
    except Exception as e:
        print('No se pudo registrar el resultado de la muestra: {}'.format(e))


def lambda_handler(event:dict, context:dict):
    """
    Función principal

    Args:
        event (dict): Datos de evento
        context (dict): Datos de contexto
        
    Returns:
        None: Personalizado
    """

    # Procesa TODOS los records del batch SQS (antes solo se leia Records[0],
    # perdiendo el resto si el trigger usa BatchSize>1). Se re-invoca el handler
    # con un record a la vez para reutilizar el flujo existente por-registro.
    _records = event.get("Records") if isinstance(event, dict) else None
    if _records and len(_records) > 1:
        _results = []
        for _rec in _records:
            _results.append(lambda_handler({"Records": [_rec]}, context))
        return _results
    global customer_name
    global tenant
    global provider
    global template_name
    global from_email
    global process_detail_id
    global process_id
    global configuration_set

    # Obtener la fecha y hora actual
    now = datetime.utcnow()
    # Formatear la fecha y hora según un formato específico
    formatted_date = now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + 'Z'
    process_detail_id = str(uuid.uuid4())

    try:
        # Obtener datos del evento

        body = event["Records"][0]["body"]
        print(body)
        json_body = json.loads(body)

        customer_id = json_body["customerId"]

        customer_name = json_body["customerName"]
        # NIT (companyTin) → llave de las tablas por cliente (tenant_key). Viaja en el
        # mensaje SQS (build_ctx). Las tablas del cliente son {tenant}_sendDetail, etc.
        tenant = tenant_key(json_body.get("nit"))
        print("Customer: " + customer_name)
        process_id = json_body["processId"]
        campaign_id = json_body["campaignId"]
        # ¿Es un envío de MUESTRAS? (lo marca Prepare-batch en el ctx). Si sí, al terminar
        # OK se cuenta 1 en campaign.samplesSentCount (no se cuenta si el envío falla).
        is_samples = bool(json_body.get("samples", False))
        from_email = json_body["fromEmail"]
        # Config set SES → IP dedicada del cliente (o el general). Lo resolvió Prepare-batch
        # y viaja en el mensaje; fallback defensivo al general para mensajes viejos en vuelo.
        configuration_set = json_body.get("configurationSet") or DEFAULT_CONFIGURATION_SET
        # Proveedor del canal (aws/socketlabs), resuelto por Prepare-batch. La credencial
        # se valida en el bloque `else`, NO aquí: este `try` traga cualquier excepción con
        # un print, así que un lote sin credenciales quedaba ACKeado (SQS lo borra) sin
        # haber enviado nada. Ver la llamada a _check_provider_config más abajo.
        provider = str(json_body.get("provider") or 'aws').strip().lower()
        headers = json_body["headers"]
        template_name = json_body["templateName"]
        part = json_body["part"]
        data = json_body["data"]
        registers = len(data)
        print(f"Cantidad registros a procesar: {registers}")
        
        # La idempotencia se hace por CHUNK en el bloque de envío (no a nivel de parte), para
        # poder REANUDAR un envío parcial sin reenviar los sub-lotes ya enviados (ver abajo).
        print(f"Parte {part}: {registers} registros a enviar en chunks de {QUANTITY_BATCH}")
    except Exception as e:
        print(e)
        print("Error en la lectura de los datos de entrada")

    else:
        # ⚠️ Validar la credencial ANTES del bucle de chunks: un error de configuración
        # debe FALLAR el lote (excepción → SQS reintenta → DLQ), no quemar chunks con
        # estados falsos. Va aquí, fuera del `try` de lectura de entrada, porque ese
        # `except` se traga la excepción y el lote quedaría ACKeado sin enviar nada.
        _check_provider_config(provider)

        default_tags = [{
                "Name":"customer",
                "Value":customer_name
            },
            {
                # NIT saneado (tenant_key): con esto ReceptionStatus reconstruye la tabla
                # {tenant}_sendStatus del cliente. Valor alfanumérico → tag SES válido.
                "Name":"nit",
                "Value":tenant
            },
            {
                "Name":"campaingId",
                "Value":campaign_id
            },
            {
                "Name":"processId",
                "Value":process_id
        }]

        print(f"Encabezados de personalizacion ({headers})")
        #Realizar la asignacion de variables y datos para la personalizacion

        # Envío por CHUNKS con idempotencia + REANUDACIÓN (checkpoint intra-parte). Cada chunk
        # [start..end) se reclama de forma ATÓMICA (clave DETERMINISTA processId#part#send#{start}
        # vía _claim_part): si ya fue enviado (por otra entrega o un intento previo que falló más
        # adelante), se OMITE — no se reenvía. Si la llamada a SES del chunk FALLA (no entregó
        # nada), se LIBERA su claim y se RE-LANZA: la redelivery de SQS reanuda EXACTAMENTE desde
        # ese chunk, sin repetir los ya enviados ni perder los pendientes. Antes, un fallo a mitad
        # marcaba TODA la parte en 'Error' y la bloqueaba → los chunks siguientes se perdían y un
        # reintento reenviaba desde cero. Compromiso (igual que antes, pero de grano fino): favorece
        # "sin duplicados" (reputación SES) → una caída DURA entre reclamar y enviar deja ese único
        # chunk (≤QUANTITY_BATCH) sin enviar.
        any_sent = False
        for start in range(0, registers, QUANTITY_BATCH):
            end = start + QUANTITY_BATCH
            chunk_len = min(end, registers) - start
            if not _claim_part(tenant, process_id, part, chunk_len, formatted_date, stage=f'send#{start}'):
                print(f"Chunk {start} de la parte {part} ya enviado; se omite (reanudación).")
                continue
            try:
                print(f"Procesando registros {start} a {end}")
                send_bulk(data, headers, start, end, default_tags)
                any_sent = True
            except Exception as e:
                # La llamada a SES falló (no entregó nada): libera el claim del chunk para que la
                # redelivery lo reintente, y re-lanza para que SQS reprocese la parte (reanuda).
                _release_part(tenant, process_id, part, stage=f'send#{start}')
                print(f"Error enviando el chunk {start} de la parte {part} del proceso {process_id}: {e}")
                if is_samples:
                    note_sample_result(campaign_id, False, e)
                raise

        print("Proceso de envios finalizado")
        # Muestras: contar 1 SOLO si esta invocación envió algo nuevo (any_sent). En una redelivery
        # donde todos los chunks ya estaban enviados no se recuenta (any_sent=False).
        if is_samples and campaign_id and any_sent:
            note_sample_result(campaign_id, True)
