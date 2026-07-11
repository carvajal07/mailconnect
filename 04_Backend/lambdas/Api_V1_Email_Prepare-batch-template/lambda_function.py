'''
Lambda para preparar la base de datos del cliente para su posterior envio
'''
import os
import re
import csv
import sys
import json
import uuid
import time
from datetime import datetime

import boto3
import pandas as pd
from botocore.exceptions import ClientError

#pylint: disable=C0301
#pylint: disable=C0303
#Podemos manejar cada mensaje de SQS para EM con 250 registros cada uno
#SQS soporta un peso de 256kb

#podemos recibir por cada registro el identificador unico, email y 20 opcionales para personalizacion

#EM  -> Email marketing                  #Real:250
#EAU -> Email con adjunto unico          #Real:250
#EAP -> Email con adjunto personalizado  #Real:100

REGISTERS_FOR_EM:int = 250
REGISTERS_FOR_EAU:int = 250
REGISTERS_FOR_EAP:int = 100
REGISTERS_FOR_SMS:int = 100
REGISTERS_FOR_WSP:int = 100
REGISTERS_FOR_VOICE:int = 50

URL_SQS_EM = 'https://sqs.us-east-1.amazonaws.com/873837768806/Email_Send-batch-template-EM'
URL_SQS_EAU = 'https://sqs.us-east-1.amazonaws.com/873837768806/Email_Send-batch-raw-EAU'
#URL_SQS_EAP = 'https://sqs.us-east-1.amazonaws.com/873837768806/Email_Send-batch-raw-EAP'
URL_SQS_EAP = 'https://sqs.us-east-1.amazonaws.com/873837768806/Template_Combination-EAP'
# Canal SMS: cola que consume la lambda Api_V1_Sms_Send-batch (AWS End User Messaging).
URL_SQS_SMS = 'https://sqs.us-east-1.amazonaws.com/873837768806/Sms_Send-batch'
# Canal WhatsApp: cola que consume la lambda Api_V1_Wsp_Send-batch (End User Messaging Social).
URL_SQS_WSP = 'https://sqs.us-east-1.amazonaws.com/873837768806/Wsp_Send-batch'
# Canal Voz: cola que consume la lambda Api_V1_Voice_Send-batch (End User Messaging Voice).
URL_SQS_VOICE = 'https://sqs.us-east-1.amazonaws.com/873837768806/Voice_Send-batch'
REGION = 'us-east-1'
DELIMITER = ';'          # delimitador por defecto si no se puede detectar
CANDIDATE_DELIMITERS = [';', ',', '\t', '|']
ENCODING = 'utf-8'


def detect_delimiter(temp_file, default=DELIMITER):
    """Detecta el delimitador del CSV leyendo el encabezado: elige, entre ; , tab |,
    el que más aparece en la primera línea con datos. Así el cliente puede subir la
    base con cualquiera de los 4 delimitadores (antes se asumía siempre ';')."""
    try:
        with open(temp_file, 'r', encoding=ENCODING) as f:
            for line in f:
                if line.strip():
                    counts = {d: line.count(d) for d in CANDIDATE_DELIMITERS}
                    best = max(counts, key=counts.get)
                    chosen = best if counts[best] > 0 else default
                    print("Delimitador detectado: {!r}".format(chosen))
                    return chosen
    except Exception as e:
        print("No se pudo detectar el delimitador ({}); se usa {!r}".format(e, default))
    return default


class ProcessState:
    """Estado POR INVOCACIÓN del envío. Antes vivía en variables globales del módulo, un
    patrón frágil en Lambda "caliente" (los globals persisten entre invocaciones y se
    pisan). Ahora se arma UNA vez en el handler y se pasa EXPLÍCITAMENTE a
    preparar_muestras()/preparar_real() y a los helpers que lo necesitan."""

    def __init__(self):
        self.process_id = None
        self.campaign_id = None
        self.customer_id = None
        self.customer_name = None
        self.formatted_date = None
        self.from_email = None
        self.headers = None
        self.template_name = None
        self.attachment = False
        self.sms_body = ''       # texto SMS (solo canal SMS)
        self.wsp_template = ''   # nombre HSM (solo canal WSP)
        self.voice_message = ''  # texto TTS (solo canal VOZ)


# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb', region_name=REGION)

# Inicializa el cliente de S3
s3 = boto3.client('s3', region_name=REGION)

# Configurar el cliente de SQS
sqs = boto3.client('sqs', region_name=REGION)

# Inicializar el cliente SES
ses = boto3.client('ses', region_name=REGION)

table_process = dynamodb.Table('process')
table_campaign = dynamodb.Table('campaign')
table_customer = dynamodb.Table('customer')

# Máximo de OPERACIONES de envío de muestras permitidas por campaña (acumulado en toda
# la vida de la campaña). Cada llamada a Send-batch-template-samples cuenta como 1.
MAX_SAMPLE_SENDS:int = 5


class RealSendDisabled(Exception):
    """El cliente tiene deshabilitados los envíos reales (campo realSendEnabled=false)."""


class AlreadySending(Exception):
    """La campaña ya tomó el lock de envío real (otro proceso / reintento). Idempotencia."""


# Estados desde los que se PUEDE iniciar un envío real (compare-and-set atómico).
REAL_SEND_ALLOWED_STATES = ('Pendiente', 'Muestras', 'Error')


def insert_process(st:'ProcessState',campaign_name:str,user_id:str,registers_on_spool:int,registers_to_send:int,quantity_blacklist:int,quantity_unsubscribe:int,quantity_deletions:int,parts:int,template_version:int,state:str)->None:
    """
    Esta función inserta los datos del proceso completo, con sus cantidades.

    Args:
        st (ProcessState): Estado de la invocación (process_id, customer_name, campaign_id, fecha)
        campaign_name (str): En el campo proceso se inserta el nombre de la campaña
        user_id (str): Identificador unico del usuario
        registers_on_spool (int): Cantidad de registros que llegaron en la BD del cliente
        registers_to_send (int): Cantidad de registros a enviar, descontando los errores, lista negra y desinscritos
        quantity_blacklist (int): Cantidad de registros encontrados en la lista negra del cliente
        quantity_unsubscribe (int): Cantidad de registros encontrados en la lista de desinscritos
        quantity_deletions (int): Cantidad de registros con estructura de email incorrecta
        parts (int): Cantidad de partes a enviar (Dividiendo el total de registros a enviar en paquetes de 500 para EM y EAU, y en paquetes de 100 para EAP)
        template_version (int): Version del template que se va a enviar
        state (str): Estado del envio, inicialmente "Procesando"

    Returns:
        None: No retorna resultados
    """
    # Insertar datos en la tabla de campañas
    table_process.put_item(
        Item={
            'processId': st.process_id,
            'customerName': st.customer_name,
            'campaignName': campaign_name,
            'campaignId': st.campaign_id,
            'userId': user_id,
            'registersOnSpool': registers_on_spool,
            'registersToSend': registers_to_send,
            'quantityBlacklist': quantity_blacklist,
            'quantityUnsubscribe': quantity_unsubscribe,
            'quantityDeletions': quantity_deletions,
            'parts': parts,
            'templateVersion': template_version,
            'date': st.formatted_date,
            'processState': state
        }
    )

def update_campaign_status(st:'ProcessState',state:str)->None:
    """
    Esta función realiza la actualizacion del estado de la campaña.

    Args:
        st (ProcessState): Estado de la invocación (campaign_id)
        state (str): Estado de la campaña

    Returns:
        None: No retorna resultados
    """
    response_update_campaign_status = table_campaign.update_item(
        Key={'campaignId':st.campaign_id},
        UpdateExpression='SET campaignState = :s',
        ExpressionAttributeValues={':s': state},
        ReturnValues='UPDATED_NEW'
    )
    print(response_update_campaign_status['Attributes'])


def try_start_real_send(st:'ProcessState',process_id_value:str)->bool:
    """IDEMPOTENCIA del envío real. Transición ATÓMICA de la campaña a 'Enviando' SOLO si su
    estado actual permite iniciar el envío (Pendiente/Muestras/Error), y guarda el processId
    ganador en `sendProcessId`.

    Devuelve True si ESTA invocación ganó el lock; False si otra ya lo tomó (reintento de
    Lambda/API Gateway, doble clic o envío concurrente) → NO se debe re-encolar. Cierra la
    ventana de carrera entre leer el estado y marcarlo 'Enviando'."""
    try:
        table_campaign.update_item(
            Key={'campaignId': st.campaign_id},
            UpdateExpression='SET campaignState = :sending, sendProcessId = :pid',
            ConditionExpression='campaignState IN (:s1, :s2, :s3)',
            ExpressionAttributeValues={
                ':sending': 'Enviando',
                ':pid': process_id_value,
                ':s1': REAL_SEND_ALLOWED_STATES[0],
                ':s2': REAL_SEND_ALLOWED_STATES[1],
                ':s3': REAL_SEND_ALLOWED_STATES[2],
            }
        )
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise

def select_campaign(campaign_name:str)->dict:
    """
    Esta función obtiene los datos de la campaña.

    Args:
        campaign_name (str): Nombre de la campana

    Returns:
        dict: Nombre de la campaña
    """
    projection_campaign_expression = 'campaignId, customerId, consecutive, channel, dataPath, campaignState, originEmail, template, samplesSentCount'  # Lista de campos a consultar

    response_campaign = table_campaign.scan(
        FilterExpression="campaignName = :value",
        ExpressionAttributeValues={":value": campaign_name},
        ProjectionExpression=projection_campaign_expression
    )
    return response_campaign


def increment_samples_count(st:'ProcessState')->int:
    """Suma 1 (atómico) al contador de envíos de muestras de la campaña actual y
    devuelve el nuevo valor."""
    response = table_campaign.update_item(
        Key={'campaignId': st.campaign_id},
        UpdateExpression='SET samplesSentCount = if_not_exists(samplesSentCount, :zero) + :one',
        ExpressionAttributeValues={':one': 1, ':zero': 0},
        ReturnValues='UPDATED_NEW'
    )
    return int(response['Attributes'].get('samplesSentCount', 0))


def is_real_send_enabled(customer_id_value:str)->bool:
    """¿El cliente tiene habilitados los envíos reales? Lee el campo realSendEnabled
    de la tabla customer. Si falta el campo (clientes antiguos) se asume HABILITADO
    (fail-open, para no bloquear a nadie por una migración pendiente)."""
    try:
        response = table_customer.scan(
            FilterExpression="customerId = :value",
            ExpressionAttributeValues={":value": customer_id_value},
            ProjectionExpression='realSendEnabled'
        )
        if response['Items']:
            return bool(response['Items'][0].get('realSendEnabled', True))
    except Exception as e:
        print("No se pudo verificar realSendEnabled ({}); se asume habilitado".format(e))
    return True

def build_ctx(st:'ProcessState')->dict:
    """Arma el contexto del envío (los campos que van en cada mensaje SQS) a partir del
    estado `st` de la invocación. Las funciones puras de abajo reciben `ctx` y no leen
    ningún estado global."""
    return {
        "customerId": st.customer_id,
        "customerName": st.customer_name,
        "processId": st.process_id,
        "campaignId": st.campaign_id,
        "attachment": st.attachment,
        "fromEmail": st.from_email,
        "headers": st.headers,
        "templateName": st.template_name,
        "smsBody": st.sms_body,          # texto SMS (solo canal SMS)
        "wspTemplate": st.wsp_template,  # nombre HSM (solo canal WSP)
        "voiceMessage": st.voice_message,  # texto TTS (solo canal VOZ)
    }


def prepare_message(ctx:dict, data:list, part:int)-> str:
    """Crea el JSON de UN mensaje SQS a partir del contexto `ctx` (ver build_ctx) + los
    registros `data` de ese lote y el número de parte. Función PURA (no lee globals),
    testeable de forma aislada."""
    body = dict(ctx)  # copia de los campos comunes del envío
    body["part"] = part
    body["data"] = data
    return json.dumps(body)


def classify_and_enqueue(ctx:dict, registers_correct:list, blacklist_emails:set,
                         unsubscribes_emails:set, registers_for_message:int,
                         url_sqs:str, send_fn=None):
    """Núcleo del envío real (extraído del handler para poder testearlo). Clasifica los
    registros con estructura válida en (lista negra / desuscritos / a enviar), agrupa los
    'a enviar' en lotes de `registers_for_message` y los ENCOLA en SQS.

    Devuelve (registers_blacklist, registers_unsubscribe, enqueued, parts):
      - registers_blacklist / registers_unsubscribe: filas filtradas (para registrar su estado).
      - enqueued: cantidad realmente encolada.
      - parts: número de mensajes SQS generados.
    `send_fn` permite inyectar un doble en las pruebas (por defecto send_sqs real)."""
    if send_fn is None:
        send_fn = send_sqs
    registers_blacklist = []
    registers_unsubscribe = []
    batch = []
    count_register = 0
    parts = 0
    enqueued = 0
    for line in registers_correct:
        email = line[1]
        if email in blacklist_emails:
            registers_blacklist.append(line)
        elif email in unsubscribes_emails:
            registers_unsubscribe.append(line)
        else:
            batch.append(line)
            enqueued += 1
            count_register += 1
            if count_register == registers_for_message:
                parts += 1
                count_register = 0
                send_fn(url_sqs, prepare_message(ctx, batch, parts))
                batch = []
    # Último lote incompleto.
    if batch:
        parts += 1
        send_fn(url_sqs, prepare_message(ctx, batch, parts))
    return registers_blacklist, registers_unsubscribe, enqueued, parts

def send_sqs_batch(url_sqs:str,messages:list)->None:
    """
    Esta función realiza el envio a las colas de SQS.

    Args:
        url_sqs (str): Url de la cola SQS en AWS
        messages (list): Lista con los mensajes (Maximo 10)

    Returns:
        dict: Nombre de la campaña
    """
    print("Url: " + url_sqs)
    # OJO: antes esta función atrapaba la excepción y solo hacía print → si el encolado
    # fallaba, la campaña quedaba "Enviando"/"Procesando" pero los mensajes NO salían y
    # nadie se enteraba. Ahora el error se PROPAGA para que el bloque que llama marque la
    # campaña en Error.
    response = sqs.send_message_batch(QueueUrl=url_sqs, Entries=messages)
    print(response)
    print("Mensaje enviado")

def send_sqs(url_sqs:str,message:list)->None:
    """
    Esta función realiza el envio a las colas de SQS.

    Args:
        url_sqs (str): Url de la cola SQS en AWS
        messages (list): Lista con los mensajes (Maximo 10)

    Returns:
        dict: Nombre de la campaña
    """

    # Igual que send_sqs_batch: el error se PROPAGA (antes se tragaba con un print) para
    # que el bloque que llama marque la campaña en Error si no se pudo encolar.
    response = sqs.send_message(QueueUrl=url_sqs, MessageBody=message)
    print(response)

def check_and_create_table(table_name:str, id:str)->bool:
    """
    Esta función intenta crear una tabla en dynamo, si la puede crear retorna True, si no la crea retorna False.

    Args:
        table_name (str): Nombre de la tabla que se va a crear
        id (str): Id de la tabla a crear

    Returns:
        bool: Si puede crear la tabla retorna True, si no la crea retorna False
    """
    was_created = False
    key_schema = [
        {
            'AttributeName': id,
            'KeyType': 'HASH'
        }
    ]
    attribute_definitions = [
        {
            'AttributeName': id,
            'AttributeType': 'S'
        }
    ]
    try:
        #Intenta crear la tabla
        table = dynamodb.create_table(
            TableName=table_name,
            KeySchema=key_schema,
            AttributeDefinitions=attribute_definitions,
            BillingMode='PAY_PER_REQUEST'  #Configurar capacidad bajo demanda
        )
        print(f"La tabla '{table_name}' ha sido creada con éxito.")
        was_created = True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceInUseException':
            print(f"La tabla '{table_name}' ya existe.")
        else:
            print("Error al crear la tabla:", e)
    return was_created


def ensure_status_table(customer_name:str)->str:
    """Crea (si no existe) la tabla ÚNICA de estados del cliente {customer}_sendStatus con
    llave compuesta PK 'processId' + SK 'sendStatusId', y devuelve su nombre.

    Reemplaza al anti-patrón de una tabla por proceso ({customer}_sendStatus_{uuid}): ahora
    hay UNA tabla por cliente y cada proceso es una partición (query por processId)."""
    table_name = f'{customer_name}_sendStatus'
    try:
        dynamodb.create_table(
            TableName=table_name,
            KeySchema=[
                {'AttributeName': 'processId', 'KeyType': 'HASH'},
                {'AttributeName': 'sendStatusId', 'KeyType': 'RANGE'},
            ],
            AttributeDefinitions=[
                {'AttributeName': 'processId', 'AttributeType': 'S'},
                {'AttributeName': 'sendStatusId', 'AttributeType': 'S'},
            ],
            BillingMode='PAY_PER_REQUEST')
        print(f"La tabla '{table_name}' ha sido creada con éxito.")
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceInUseException':
            print(f"La tabla '{table_name}' ya existe.")
        else:
            print("Error al crear la tabla de estados:", e)
    return table_name

def _batch_get_emails(table_name:str, keys:list)->set:
    """
    Consulta por lotes qué emails de `keys` existen en la tabla `table_name`
    (cuya PK debe ser 'email'). BatchGetItem admite máximo 100 llaves y no
    acepta duplicados, así que se deduplica y se trocea. Si la tabla no existe
    o su esquema no coincide (tablas viejas con otra PK), devuelve vacío y
    registra el error en lugar de tumbar el envío.

    Args:
        table_name (str): Nombre de la tabla (PK 'email')
        keys (list): Lista de llaves [{'email': ...}]

    Returns:
        set: Emails encontrados en la tabla
    """
    found = set()
    unique_keys = list({k['email']: k for k in keys}.values())
    try:
        for start in range(0, len(unique_keys), 100):
            chunk = unique_keys[start:start + 100]
            request_items = {table_name: {'Keys': chunk, 'ProjectionExpression': 'email'}}
            while request_items:
                response = dynamodb.batch_get_item(RequestItems=request_items)
                for item in response.get('Responses', {}).get(table_name, []):
                    found.add(item['email'])
                # Reintentar las llaves que DynamoDB no alcanzó a procesar.
                request_items = response.get('UnprocessedKeys') or None
    except Exception as e:
        print(f'No se pudo consultar la tabla {table_name} (se continúa sin filtrar): {e}')
        return set()
    return found

def check_blacklist(customer_name:str, keys:list)->set:
    """
    Consulta los email en la lista negra del cliente. La tabla
    '{customer}_blackList' se crea con PK 'email' (ReceptionStatus escribe
    compatible porque su Item incluye 'email'). Tablas viejas con PK
    'blackListId' devuelven vacío sin interrumpir el envío.
    """
    return _batch_get_emails(f'{customer_name}_blackList', keys)

def check_unsubscribes(customer_name:str, keys:list)->set:
    """
    Consulta los email desuscritos del cliente. La tabla '{customer}_unsubscribe'
    se crea con PK 'email' (igual que la escribe la lambda Unsubscribe).
    """
    return _batch_get_emails(f'{customer_name}_unsubscribe', keys)

def insert_mails_status(st:'ProcessState',emails:list,state:str,description:str)->None:
    """
    Función encargada de insertar los detalles de cada envio a la base de datos con su respectivo estado. Aplica solo para desinscritos y lista negra

    Args:
        st (ProcessState): Estado de la invocación (process_id, customer_name, fecha)
        emails (list): Lista con los email de lista negra o desinscritos que se van a insertar a la base de datos
        state (str): Estado 12 (Desinscrito) o 13 (Lista negra)
        description (str): Descripcion de cualquiera de los dos estados

    Returns:
        None: No retorna resultados
    """
    start_time = time.time()
    data_to_insert_send_detail = []
    data_to_insert_send_status = []
    # Define los datos que deseas insertar
    for register in emails:
        id = str(uuid.uuid4())

        unique_id = register[0]
        email = register[1]

        #Data para insertar en los datos de envios
        data_to_insert_send_detail.append({
            'sendDetailId': id,
            'processDetailId': id,
            'uniqueId': unique_id,
            'email': email,
            'data': register,
            'date': st.formatted_date
        })

        #Data para insertar en los estados. processId = PK (tabla única {customer}_sendStatus).
        data_to_insert_send_status.append({
            'processId': st.process_id,
            'sendStatusId': id,
            'sendDetailId': id,
            'date': st.formatted_date,
            'state': state,
            'type1': description,
            'type2': description
        })

    table_name_details = f'{st.customer_name}_sendDetail_{st.process_id}'
    table_details = dynamodb.Table(table_name_details)

    #Almacena en bufer la data para hacer el insert por batch y maneja internamente los reintentos de elementos no procesados
    with table_details.batch_writer() as batch:
        for item in data_to_insert_send_detail:
            batch.put_item(Item=item)

    # Tabla ÚNICA de estados del cliente (antes: una por proceso).
    table_status = dynamodb.Table(f'{st.customer_name}_sendStatus')
    with table_status.batch_writer() as batch:
        for item in data_to_insert_send_status:
            batch.put_item(Item=item)
    end_time = time.time()
    tiempo = (end_time - start_time) * 1000
    print(f"{tiempo:.2f} milisegundos")

def upload_s3(bucket_name:str,object_key:str,data:any) ->None:
    try:
        list_string = str(data)
        file_content_bytes = bytes(list_string, 'utf-8')
        response = s3.put_object(
            Bucket=bucket_name,
            Key=object_key,
            Body=bytes(file_content_bytes)
        )
        print(f"File '{object_key}' uploaded successfully to bucket '{bucket_name}'.")
    except Exception as e:
        print(f"Error uploading file: {e}")

def validate_csv():
    pass


def preparar_muestras(st, data, response_campaign, user_id, template_version,
                      temp_file, delimiter, url_sqs, patron_email):
    """Rama de ENVÍO DE MUESTRAS (correos de prueba). Reemplaza el correo real de los
    primeros registros (o de las identificaciones seleccionadas) por los correos de
    prueba y los encola. No toca la base real ni marca la campaña como 'Enviando'.

    Devuelve (status, status_code, description). El estado `st` lleva todo el contexto
    de la invocación (antes eran globals)."""
    status = True
    status_code = 200
    description = "Campaña enviandose correctamente"

    registers = []
    count_register = 0

    print("Inica proceso de envio de muestras")
    process = data["campaignName"] + "-Samples"
    quantity_samples = data['quantitySamples']
    print("Cantidad  muestras en el payload: " + str(quantity_samples))
    selective_samples = data.get('selectiveSamples', False)
    recipients = data["recipients"]
    print(f"Correos de muestras: {recipients}")
    #Validar que los email sean correctos
    quantity_recipients = len(recipients)
    invalid_mail = False
    invalid_mails = ""

    registers_to_send = 0
    quantity_blacklist = 0
    quantity_unsubscribe = 0
    quantity_deletions = 0
    for email in recipients:
        if not re.match(patron_email, email):
            invalid_mail = True
            invalid_mails += email

    # Límite de envíos de muestras por campaña (acumulado). Cada operación de muestras
    # cuenta 1; al llegar a MAX_SAMPLE_SENDS se bloquea (evita abuso/costos con envíos
    # de prueba repetidos).
    samples_sent_before = int(response_campaign['Items'][0].get('samplesSentCount', 0))
    limit_reached = samples_sent_before >= MAX_SAMPLE_SENDS
    print(f"Muestras enviadas antes: {samples_sent_before}/{MAX_SAMPLE_SENDS}")

    if limit_reached:
        description = (f'Se alcanzó el máximo de {MAX_SAMPLE_SENDS} envíos de '
                       f'muestras para esta campaña. Aprueba y envía la campaña '
                       f'real o crea una nueva campaña.')
        status = False
        print(description)
        status_code = 429
        return status, status_code, description

    if invalid_mail:
        description = f'Error en las direcciones email enviadas para las muestras, emails con error: {invalid_mails}'
        status = False
        print(description)
        status_code = 400
        return status, status_code, description

    print("Todos los email enviados son validos")
    if selective_samples:
        print("Proceso con muestras selectivas")
        #En el proceso de muestras selectivas solo se van a enviar la cantidad de registros que se encuentren en el spool del cliente
        #No se realizara el proceso de completar la cantidad de muestras
        try:
            # Las identificaciones llegan del front como texto; el spool trae line[0]
            # numérico. Normalizamos ambos a texto (sin espacios) para que la comparación
            # haga match (antes int == str nunca coincidía y no se enviaba nada).
            sample_identifications = set(str(i).strip() for i in data["identifications"])
            index_recipient = 0
            samples_count = 0
            print(f"Identificaciones para las muestras: {sample_identifications}")

            print('Inicio lectura del archivo para filtrar los registros de muestras selectivas y reemplazar el email real con el de muestras')
            with open(temp_file, 'r', encoding=ENCODING) as file:
                print("Apertura correcta del archivo Csv")
                # Delimitador detectado (no se asume ';')
                reader = csv.reader(file, delimiter=delimiter)
                print("Lectura correcta del archivo como Csv")
                st.headers = next(reader)  # primer linea = encabezado
                print("Headers: " + str(st.headers))
                for line in reader:
                    #Reviso si ya asigne la cantidad total de muestras para no seguir recorriendo las lineas
                    if samples_count == quantity_samples:
                        print("Salgo del bucle porque ya encontre todas las muestras solicitadas")
                        break
                    id = str(line[0]).strip()
                    for identification in sample_identifications:
                        if id == identification:
                            samples_count += 1
                            print("Muestra selectiva encontrada en la base de datos del cliente")
                            #Reemplazar email real
                            if index_recipient == quantity_recipients:
                                index_recipient = 0
                            #Reemplazar el email real por el email de muestras
                            new_email = recipients[index_recipient]
                            real_email = line[1]
                            print(f'Reemplazando el email "{real_email}" por el email "{new_email}"')
                            line[1] = new_email
                            registers.append(line)
                            index_recipient += 1
                            break

            registers_to_send = samples_count
        except Exception as e:
            print(e)
            update_campaign_status(st, "Error")
            description = 'Error en el filtrado de los registros desde la base de datos original'
            status = False
            print(description)
            status_code = 400
        else:
            print('Los filtros de registros se realizaron de manera correcta')
            samples_found = len(registers)
            if samples_found > 0:
                print("Se procede a realizar los envios a la cola")
                messages = prepare_message(build_ctx(st), registers, 1)
                send_sqs(url_sqs, messages)
            else:
                print(f'No se encontro ningura de las cedulas "{sample_identifications}" en el spool de envios')
    else:
        print("Proceso con muestras automaticas")
        try:
            #Se realiza el envio de la cantidad de email indicados con la data de los primeros registros de la BD
            index_recipient = 0
            print('Inicio lectura del archivo para tomar los primeros registros y reemplazar el email real con el de muestras')
            with open(temp_file, 'r', encoding=ENCODING) as file:
                print("Apertura correcta del archivo Csv")
                reader = csv.reader(file, delimiter=delimiter)
                print("Lectura correcta del archivo como Csv")
                st.headers = next(reader)  # primer linea = encabezado
                print("Headers: " + str(st.headers))
                for line in reader:
                    print("Registro a procesar: " + str(line))
                    #Reinicio el indice de los recipient para cuando la cantidad de muestras es mayor a los email enviados en la lista
                    if index_recipient == quantity_recipients:
                        index_recipient = 0
                    #Reemplazar el email real por el email de muestras
                    print(recipients)
                    new_email = recipients[index_recipient]
                    print(f"Line: {line}")
                    real_email = line[1]
                    print(f'Reemplazando el email "{real_email}" por el email "{new_email}"')
                    line[1] = new_email
                    registers.append(line)
                    count_register += 1
                    index_recipient += 1
                    if count_register == quantity_samples:
                        print("Preparar mensaje para enviar")
                        messages = prepare_message(build_ctx(st), registers, 1)
                        send_sqs(url_sqs, messages)
                        registers = []
                        break
            #Valido si hay registros, es decir que la BD original no contenia los suficientes registros para las muestras
            if registers:
                print("La cantidad de muestras solicitada es mayor a la data que se encuentra en la BD")
                messages = prepare_message(build_ctx(st), registers, 1)
                send_sqs(url_sqs, messages)

            # Elimina el archivo temporal descargado
            os.remove(temp_file)
            print("Se elimino el archivo temporal")
            registers_to_send = len(registers)
            print("Se asigno nuevamente la cantidad de registros a enviar")
        except:
            update_campaign_status(st, "Error")
            description = 'Error en el proceso de muestras automaticas'
            status = False
            print(description)
            status_code = 400

    insert_process(st, process, user_id, registers_to_send, registers_to_send, quantity_blacklist, quantity_unsubscribe, quantity_deletions, 1, template_version, "Muestras")
    print("Finaliza insercion en la tabla de procesos")
    update_campaign_status(st, "Muestras")
    print("Finaliza actualizacion de la tabla de estado de la campaña")
    # Solo se cuenta la operación de muestras si salió bien.
    if status:
        nuevo_conteo = increment_samples_count(st)
        print(f"Envíos de muestras usados: {nuevo_conteo}/{MAX_SAMPLE_SENDS}")

    return status, status_code, description


def preparar_real(st, data, response_campaign, user_id, template_version, temp_file,
                  delimiter, url_sqs, channel_name, unsubscribe_existed,
                  blacklist_existed, patron_email):
    """Rama de ENVÍO REAL (a toda la base). Aplica el bloqueo por cliente y la idempotencia,
    lee el spool, filtra estructura/lista negra/desuscritos, agrupa en lotes y encola a SQS,
    y registra el proceso + los estados de los filtrados.

    Devuelve (status, status_code, description). Puede lanzar RealSendDisabled/AlreadySending,
    que el handler atrapa. El estado `st` lleva todo el contexto (antes eran globals)."""
    status = True
    status_code = 200
    description = "Campaña enviandose correctamente"

    print("Inicia proceso de envio real")
    # Bloqueo por cliente: si el cliente tiene deshabilitados los envíos reales, no se
    # procesa la campaña real (las muestras sí). Se lanza RealSendDisabled y se atrapa en
    # el handler (mantiene el 403 y NO marca la campaña en Error).
    if not is_real_send_enabled(st.customer_id):
        raise RealSendDisabled(
            'Los envíos reales están deshabilitados para este cliente. '
            'Contacta al administrador de MailConnect.')
    # IDEMPOTENCIA: transición atómica a 'Enviando'. Si otra invocación (reintento de
    # Lambda/API Gateway, doble clic, envío concurrente) ya tomó el lock, NO se re-encola
    # (se lanza AlreadySending → 200 limpio).
    if not try_start_real_send(st, st.process_id):
        raise AlreadySending('La campaña ya está en proceso de envío; no se re-encola.')

    if (channel_name == "EM"):
        registers_for_message = REGISTERS_FOR_EM
    if (channel_name == "EAU"):
        registers_for_message = REGISTERS_FOR_EAU
    if (channel_name == "EAP"):
        registers_for_message = REGISTERS_FOR_EAP
    if (channel_name == "SMS"):
        registers_for_message = REGISTERS_FOR_SMS
    if (channel_name == "WSP"):
        registers_for_message = REGISTERS_FOR_WSP
    if (channel_name == "VOZ"):
        registers_for_message = REGISTERS_FOR_VOICE
    global_counter_message = 0

    keys = []
    emails_error = []
    registers_unsubscribe = []
    registers_blacklist = []
    registers_correct = []
    registers_on_spool = 0
    registers_to_send = 0
    quantity_blacklist = 0
    quantity_unsubscribe = 0
    quantity_deletions = 0
    # Lee el archivo CSV descargado y agrupa los datos
    try:
        print("Lectura del archivo spool para validar registros con estructura de email incorrecta")
        with open(temp_file, 'r', encoding=ENCODING) as file:
            reader = csv.reader(file, delimiter=delimiter)
            st.headers = next(reader)  # primer linea = encabezado
            print("Headers: " + str(st.headers))
            for line in reader:
                registers_on_spool += 1
                #En este primer for recorro los registros y verifico si no tienen error de estructura
                #Los registros sin error los guardo para luego verificar en las listas negras y unsubscribe
                #Los registros buenos los agrego a un array y los malos a otro
                email = line[1]
                if re.match(patron_email, email):
                    #Voy agregando los email a una lista para posteriormente verificar si estan en lista negra o desinscritos
                    keys.append({'email': email})
                    registers_correct.append(line)
                else:
                    emails_error.append(line)
        print("Finaliza lectura del archivo spool para validar registros con estructura de email incorrecta")
        #consultar registros en unsubscribe y blacklist
        #Solo se consulta si la tabla ya existía (si es el primer proceso del cliente, las
        #tablas recién creadas están vacías).
        blacklist_emails = set()
        unsubscribes_emails = set()
        if unsubscribe_existed:
            unsubscribes_emails = check_unsubscribes(st.customer_name, keys)
            quantity_unsubscribe = len(unsubscribes_emails)
        if blacklist_existed:
            blacklist_emails = check_blacklist(st.customer_name, keys)
            quantity_blacklist = len(blacklist_emails)

        print("Cantidad registros en blacklist: " + str(quantity_blacklist))
        print("Cantidad registros en unsubscribe: " + str(quantity_unsubscribe))

        quantity_deletions = len(emails_error)
        print("Cantidad registros con estructura incorrecta: " + str(quantity_deletions))

        print("Inicio de clasificacion email correctos para el envio")

        # Clasificación + agrupación en lotes + encolado a SQS, extraído a una función pura
        # y testeable (antes: bucle anidado en el handler).
        registers_blacklist, registers_unsubscribe, registers_to_send, global_counter_message = \
            classify_and_enqueue(
                build_ctx(st), registers_correct, blacklist_emails,
                unsubscribes_emails, registers_for_message, url_sqs)
        print(f"Encolados: {registers_to_send} en {global_counter_message} mensaje(s)")
    except Exception as e:
        update_campaign_status(st, "Error")
        print(e)
        print('Error en el proceso de envios reales')
        status = False
        description = 'Error en el proceso de envios reales'
        status_code = 400
    else:
        print("TotalMensajes: " + str(global_counter_message))
        #El total de mensajes es el total de partes para insertar en processDetail
        insert_process(st, data["campaignName"], user_id, registers_on_spool, registers_to_send, quantity_blacklist, quantity_unsubscribe, quantity_deletions, global_counter_message, template_version, "Procesando")
        #Elimina el archivo temporal descargado
        os.remove(temp_file)

        print("Proceso de registro de errores en la tabla de processDetail")
        #Insertar los email con estructura invalida en las tablas de estados y de datos
        insert_mails_status(st, emails_error, 11, "El email no tiene una estructura valida")
        #Insertar los email desinscritos en las tablas de estados y de datos
        insert_mails_status(st, registers_unsubscribe, 12, "El email se encuentra desinscrito para este cliente")
        #Insertar los email que estaban en la lista negra en las tablas de estados y de datos
        insert_mails_status(st, registers_blacklist, 13, "El email se encuentra en la lista negra de este cliente")

    return status, status_code, description


def lambda_handler(event, context):
    """
    Función principal. Hace el SETUP común (parseo, campaña, tablas, descarga del CSV) y
    DESPACHA a preparar_muestras() o preparar_real() según el endpoint. El estado de la
    invocación viaja en un objeto ProcessState (antes eran variables globales).

    Args:
        event (dict): Datos de evento
        context (dict): Datos de contexto

    Returns:
        None: Personalizado
    """
    st = ProcessState()

    status = True
    description = "Campaña enviandose correctamente"
    status_code = 200

    # Obtener la fecha y hora actual
    now = datetime.utcnow()
    # Formatear la fecha y hora según un formato específico
    st.formatted_date = now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + 'Z'

    try:
        # Obtener datos del evento
        endpoint = event["resource"]
        print("endpoint: " + endpoint)
        data = json.loads(event["body"])
        st.customer_name = data["customerName"]
        print("Customer: " + st.customer_name)
        campaign_name = data["campaignName"]
        user_id = data["userId"]

        #Puedo dejar estos dos datos para posiblemente mas adelante usarlos
        #Para enviar alguna prueba, muestra, reenvio de una version especifica
        template = data['template']
        template_version = data['templateVersion']
        ####################################

        samples = "Send-batch-template-samples" in endpoint
        print("Samples: " + str(samples))
        response_campaign = select_campaign(campaign_name)
        print(response_campaign)
        if response_campaign['Items']:
            print(f'La campaña "{campaign_name}" fue encontrada en la BD')
            state = response_campaign['Items'][0]["campaignState"]

            #Solo realizo envio si el estado de la campaña se encuentra en estado "Pendiente" o "Muestras"
            #Si el estado es "Enviando" o "Terminada" quiere decir que es una campaña que ya no se debe enviar
            #El estado error se debe revisar como soporte

            #Esta linea siguiente es la productiva
            #if (state == "Pendiente" or state == "Muestras"):

            #Esta linea siguiente es la de pruebas
            if (state == "Pendiente" or state == "Muestras" or state == "Error"):
                print(f'La campaña se encuentra en estado "{state}" y se puede realizar su envio')
                st.process_id = str(uuid.uuid4())
                # Detalles del archivo en S3
                bucket_name = f'{st.customer_name.lower()}.database'
                temp_file = f'/tmp/{st.customer_name}_{st.formatted_date}.tmp'  # Ruta temporal para almacenar el archivo descargado
                print("Process id:" + st.process_id)

                st.campaign_id = response_campaign['Items'][0]["campaignId"]
                print("Despues de capturar el id de campaña")
                st.customer_id = response_campaign['Items'][0]["customerId"]
                consecutive = response_campaign['Items'][0]["consecutive"]
                channel_name = response_campaign['Items'][0]["channel"]
                data_path = response_campaign['Items'][0]["dataPath"]
                st.from_email = response_campaign['Items'][0]["originEmail"]
                # Para SMS el campo 'template' de la campaña guarda el TEXTO del mensaje
                # (no un template de SES). Para email queda vacío y no se usa.
                st.sms_body = response_campaign['Items'][0].get("template", "") if channel_name == "SMS" else ""
                # Para WhatsApp el campo 'template' guarda el NOMBRE de la plantilla HSM
                # aprobada por Meta. Para el resto de canales queda vacío y no se usa.
                st.wsp_template = response_campaign['Items'][0].get("template", "") if channel_name == "WSP" else ""
                # Para Voz el campo 'template' guarda el TEXTO a leer por TTS.
                st.voice_message = response_campaign['Items'][0].get("template", "") if channel_name == "VOZ" else ""

                # Define los detalles de la tabla processDetail
                check_and_create_table(f'{st.customer_name}_processDetail', 'processDetailId')

                # Tabla de desuscritos: PK 'email' (así la escribe la lambda Unsubscribe y
                # así la consulta check_unsubscribes). Si la tabla ya existía, hay que
                # FILTRAR contra ella en el envío real.
                unsubscribe_existed = not check_and_create_table(f'{st.customer_name}_unsubscribe', 'email')

                # Tabla de lista negra: PK 'email' (igual que unsubscribe), para que el
                # filtrado por email de check_blacklist funcione directo. ReceptionStatus
                # incluye 'email' en sus inserts, así que escribe compatible. Tablas viejas
                # con PK 'blackListId' se ignoran con gracia (borrar y dejar que se recreen).
                blacklist_existed = not check_and_create_table(f'{st.customer_name}_blackList', 'email')

                #Estas tablas siempre se deben crear
                # Define los detalles de la tabla sendDetail
                check_and_create_table(f'{st.customer_name}_sendDetail_{st.process_id}', 'sendDetailId')

                # Tabla ÚNICA de estados del cliente (PK processId + SK sendStatusId).
                # Antes se creaba una tabla por proceso ({customer}_sendStatus_{uuid}).
                ensure_status_table(st.customer_name)

                st.template_name = f'{st.customer_name}_{consecutive}_{channel_name}_{campaign_name}'

                print(f"Channel: {channel_name}")
                #EAU = Email con adjunto unico (El mismo adjunto se envia a todos los destinatarios)
                #EAP = Email con adjunto personalizado (Se realiza personalizacion en campos para enviar a cada destinatario un adjunto diferente)
                if channel_name == "EAU":
                    st.attachment = True
                    url_sqs = URL_SQS_EAU
                elif channel_name == "EAP":
                    st.attachment = True
                    url_sqs = URL_SQS_EAP
                elif channel_name == "SMS":
                    st.attachment = False
                    url_sqs = URL_SQS_SMS
                elif channel_name == "WSP":
                    st.attachment = False
                    url_sqs = URL_SQS_WSP
                elif channel_name == "VOZ":
                    st.attachment = False
                    url_sqs = URL_SQS_VOICE
                else:
                    st.attachment = False
                    url_sqs = URL_SQS_EM
                print("Queue: " + url_sqs)

                try:
                    # Descarga el archivo CSV desde S3
                    s3.download_file(bucket_name, data_path, temp_file)
                except:
                    update_campaign_status(st, "Error")
                    description = f'No se pudo realizar la descarga del archivo "{temp_file}" del bucket "{bucket_name} - {data_path}"'
                    status = False
                    print(description)
                    status_code = 404
                else:
                    # Detectar el delimitador del CSV (el cliente pudo subirlo con ; , tab o |).
                    delimiter = detect_delimiter(temp_file)
                    #Estructura obligatoria por posicion: line[0]=Identificacion, line[1]=Correo, line[2]=Nombre
                    patron_email = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z0-9]{2,}$'

                    if samples:
                        status, status_code, description = preparar_muestras(
                            st, data, response_campaign, user_id, template_version,
                            temp_file, delimiter, url_sqs, patron_email)
                    else:
                        status, status_code, description = preparar_real(
                            st, data, response_campaign, user_id, template_version,
                            temp_file, delimiter, url_sqs, channel_name,
                            unsubscribe_existed, blacklist_existed, patron_email)

            #Si el estado es "Enviando" o "Terminada" quiere decir que es una campaña que ya no se debe enviar
            else:
                description = f'La campaña se encuentra en estado "{state}" y por esta razon no puede ser enviada'
                status = False
                print(description)
                status_code = 404
        else:
            description = f'La campaña "{campaign_name}" no se encuentra registrada en la Base de datos'
            status = False
            print(description)
            status_code = 404
            # No hay campaña que marcar en Error (st.campaign_id no está seteado).
    except AlreadySending as e:
        # Reintento / envío concurrente: la campaña ya tomó el lock. Es el comportamiento
        # correcto (idempotencia), NO un error: 200 y sin marcar Error ni re-encolar.
        description = str(e)
        status = True
        status_code = 200
        print(description)
    except RealSendDisabled as e:
        # Cliente con envíos reales deshabilitados: 403 claro, sin marcar Error.
        description = str(e)
        status = False
        status_code = 403
        print(description)
    except Exception as e:
        description = "Error no controlado en el servicio"
        status = False
        status_code = 500
        print(description)
        print(e)
    finally:
        # Respuesta
        response = {
            'statusCode': status_code,
            'body': json.dumps({
                'status':status,
                'status_code': status_code,
                'description':description
            })
        }

    return response
