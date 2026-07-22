###Api_V1_Email_Send-batch-template-EAU
'''
Lambda para realizar el envio de emails en lotes (Email con adjunto unico)
El email con adjunto unico es cuando a todos los destinatarios se les envia el mismo email, sin realizar ningun tipo de personalizacion
'''
import os
import hmac
import base64
import hashlib
import boto3
import json
import uuid
from botocore.exceptions import ClientError
from concurrent.futures import ThreadPoolExecutor
import copy
from string import Template
import sys
from datetime import datetime
import time
import io
import re
from botocore.exceptions import ClientError
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication

CHARSET = "ISO-8859-1"
REGION = 'us-east-1'
QUANTITY_BATCH = 25

# Bucket por cliente por NIT: {prefix}-{nit}-document (DNS-safe). Fallback al viejo por nombre.
BUCKET_PREFIX = os.environ.get('BUCKET_PREFIX', 'mailconnect')


def tenant_key(nit):
    """Llave de tenant (NIT saneado) para las tablas por cliente. Igual que en Prepare-batch
    y en los buckets S3. Idempotente."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def tenant_bucket(nit, doc_type):
    return '{}-{}'.format(BUCKET_PREFIX, tenant_key(nit))

# Desuscripción: URL de la lambda Unsubscribe y clave para firmar el token.
# En EAU el correo es MIME crudo, así que además del enlace en el HTML
# ({{unsubscribeUrl}}) se agrega el header estándar List-Unsubscribe (RFC 8058).
UNSUBSCRIBE_URL = os.environ.get('UNSUBSCRIBE_URL', 'https://api.mailconnect.com.co/V1/Email/Unsubscribe')
SECRET_KEY = os.environ.get('SECRET_KEY', '')


def build_unsubscribe_url(customer, email, tenant=''):
    """Token firmado (HMAC-SHA256) que la lambda Unsubscribe valida. `tenant` (llave por
    NIT) viaja como 'n' para que Unsubscribe nombre la tabla {tenant}_unsubscribe."""
    payload = json.dumps({'c': customer, 'e': email, 'n': tenant}, separators=(',', ':'))
    payload_b64 = base64.urlsafe_b64encode(payload.encode()).decode().rstrip('=')
    signature = hmac.new(SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{UNSUBSCRIBE_URL}?t={payload_b64}.{signature}"

#Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')

#Crea un cliente de SES
ses = boto3.client('ses', region_name=REGION)

#Crea el cliente para S3
s3 = boto3.client('s3', region_name=REGION)

global customer_name
global tenant
global campaign_id
global from_email
global subject
global process_detail_id
global process_id
global personalized_subject
global personalized_body
global personalized_text
global personalized_subjects_list
global personalized_body_list
global personalized_text_list
global msg
global html
global text
global file_content
global file_name


'''
Posiblemente necesite crear varias lambdas para los procesos de lectura de las bases de datos del cliente
dependiendo de la cantidad de registros
Debo realizar pruebas:
    con archivos de hasta 50.000 registros
    con archivos de hasta 200.000 registros
    con archivos de hasta 1.000.000 registros
    o verificar hasta cuantos registros puede procesar la memoria mas baja en la lambda sin afectar el tiempo de proceso

Esto implica tener una configuracion para cada cliente en donde se decide por cual lambda se va segun la cantidad de registros que maneja el cliente
'''

'''
Creacion de buckets para cada cliente (En que momento se deben crear?):
document (Se puede definir con el cliente el tiempo de vida de los archivos, dependiendo de si el adjunto se envia online o onfile)
database (Se puede definir tiempo de vida de un mes y posiblemente pasarlo a un S3 glaxier mas barato por unos 3 meses)
El bucket se debe crear con un ciclo de vida definido
'''

#Debo manejar 3 tipos de envio de email
#1. Email marketing
#2. Email con adjunto en url desde S3
#3. Email con adjunto en el correo



###########Proceso de envio################


#Debo enviar paquetes de 50 emails


table_document = dynamodb.Table('document')
table_campaign = dynamodb.Table('campaign')
dynamo = boto3.client('dynamodb')

def insert_processDetail(processDetailId,tenant,processId,registers,part,date,state):
    #cuenta los registros para el campo total de la tabla {tenant}_processDetail (tenant=tenant_key(NIT))
    table_processDetail = dynamodb.Table(f'{tenant}_processDetail')

    # Insertar datos en la tabla de detalle de procesos
    table_processDetail.put_item(
        Item={
            'processDetailId': processDetailId,
            'processId': processId,
            'registers': registers,
            'part': part,
            'date': date,
            'state': state
        }
    )


def _claim_part(tenant_key_value, process_id_value, part, registers, date, stage='send'):
    """Reclama ATÓMICAMENTE el derecho a enviar (processId, part) en esta ETAPA. EAU antes NO
    tenía ninguna guarda: una redelivery de SQS reenviaba TODO el lote (adjunto único) por
    duplicado. Clave DETERMINISTA `processId#part#stage` + escritura condicional
    `attribute_not_exists`: solo la PRIMERA entrega gana (True → envía); la duplicada pierde la
    condición (False → NO reenvía). Fail-open SOLO si falta la llave de tenant/proceso."""
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


def _mark_part(tenant_key_value, process_id_value, part, state, stage='send'):
    """Marca el estado final de (processId, part, stage) sobre la MISMA fila determinista que
    reclamó _claim_part. Best-effort."""
    if not tenant_key_value or not process_id_value or part is None:
        return
    try:
        dynamodb.Table(f'{tenant_key_value}_processDetail').update_item(
            Key={'processDetailId': f'{process_id_value}#{part}#{stage}'},
            UpdateExpression='SET stateProcess = :s',
            ExpressionAttributeValues={':s': state})
    except Exception as e:
        print(f'No se pudo marcar la parte {part} como {state}: {e}')


def _release_part(tenant_key_value, process_id_value, part, stage='send'):
    """Libera (borra) el claim de un chunk cuyo envío FALLÓ, para que una redelivery lo REINTENTE
    (reanudación). Sin liberar, el chunk quedaría reclamado y la reanudación lo saltaría →
    pérdida. Best-effort."""
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

    # Tabla ÚNICA de detalle del cliente (PK processId + SK sendDetailId). tenant=tenant_key(NIT).
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

def prepare_email(from_email, subject_template, html_template, text_template, data_list, headers, file_content, file_name):
    """Prepara y retorna el objeto MIME con el adjunto y personalización."""
    replacements = dict(zip(headers, data_list))

    subject = Template(subject_template).safe_substitute(replacements)
    html = Template(html_template).safe_substitute(replacements)
    text = Template(text_template).safe_substitute(replacements)

    msg = MIMEMultipart('mixed')
    msg['From'] = from_email
    msg['To'] = data_list[1]  # email
    msg['Subject'] = subject

    msg_body = MIMEMultipart('alternative')
    msg_body.attach(MIMEText(text.encode('utf-8'), 'plain', 'utf-8'))
    msg_body.attach(MIMEText(html.encode('utf-8'), 'html', 'utf-8'))
    msg.attach(msg_body)

    part = MIMEApplication(file_content)
    part.add_header('Content-Disposition', 'attachment', filename=file_name)
    msg.attach(part)

    return msg


def send_email(email, msg, tags, from_email):
    """Envía un solo email usando SES."""
    try:
        response = ses.send_raw_email(
            Source=from_email,
            Destinations=[email],
            RawMessage={'Data': msg.as_string()},
            Tags=tags,
            ConfigurationSetName="default"
        )
        print(f"Email enviado a {email}")
        return response
    except Exception as e:
        print(f"Error enviando a {email}: {e}")
        return None


def send_bulk_v2(data, headers, start, end, tags, from_email, subject, html, text, file_content, file_name):
    """Procesa y envía emails por bloques concurrentes."""

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = []

        for data_list in data[start:end]:
            email = data_list[1]
            msg = prepare_email(from_email, subject, html, text, data_list, headers, file_content, file_name)
            futures.append(executor.submit(send_email, email, msg, tags, from_email))

        # Opcional: esperar a que terminen
        for future in futures:
            future.result()

    print(f"Bloque {start}-{end} enviado.")

def get_attachments_data(customer_name:str,campaign_id:str,nit=None)->str:
    global file_name
    projection_document_expression = 'documentPath,attachmentType'  # Lista de campos a consultar

    response_document = table_document.scan(
        FilterExpression="campaignId = :value",
        ExpressionAttributeValues={":value": campaign_id},
        ProjectionExpression=projection_document_expression
    )

    #Revisar porque aca puede ser mas de un adjunto
    items = response_document['Items']
    
    if items:
        bucket_name = tenant_bucket(nit, 'document') if nit else f'{customer_name.lower()}.document'
        for item in items:
            attachment_path = item["documentPath"]
            attachment_type = item["attachmentType"]

            if (attachment_type == "ONFILE"):
                print("El archivo adjunto debe ir directo en el correo")
                # Descargar el objeto S3 en un objeto BytesIO. `documentPath` incluye el
                # prefijo del tipo (attachment/{fecha}/{nombre}); el nombre es el basename.
                file_name = attachment_path.split('/')[-1]

                s3_object = s3.get_object(Bucket=bucket_name, Key=attachment_path)
                file_content_bytes = s3_object['Body'].read()
                 # Leer el contenido del archivo como string (asumiendo codificación UTF-8)
                file_content = file_content_bytes.decode(CHARSET)
                return file_content
                part = MIMEApplication(file_content)
                part.add_header('Content-Disposition', 'attachment', filename=file_name)
                msg.attach(part)
    
            else:
                print("El archivo adjunto debe ir como una url o boton")
                pass
    else:
        print("Error, el adjunto para el envio no se encuentra registrado en la tabla de documentos")
        print(f"El id de campaña {campaign_id} no se encontro en la tabla document")

def select_template(template_name:str)->dict:
    """
    Esta función obtiene los datos de la plantilla de email.

    Args:
        template_name (str): Nombre de la plantilla en SES

    Returns:
        str: Datos del HTML para el envio
    """
    # Recuperar la plantilla de correo electrónico
    try:
        response_template = ses.get_template(TemplateName=template_name)
        print("plantilla recuperada correctamente")
    except Exception as e:
        print(e)

    return response_template

def send_bulk(data:list, headers:list, start:int, end:int, tags:dict)->None:
#def send_bulk(data:list, headers:list, from_email:str, file_content:str, subject:str, personalized_text:str, personalized_subject:str, personalized_body:str, personalized_body_list:str, html:str, text:str, start:int, end:int, tags:dict)->None:
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
        msg = MIMEMultipart('mixed')
        msg['From'] = from_email
        subject_new = subject
        html_new = html
        response = ""
        text_new = text
        del msg['Subject']
        del msg['To']
        data_list = register
        unique_id = data_list[0]
        email = data_list[1]
        emails.append(email)
        unique_ids.append(unique_id)
        msg['To'] = email

        # Desuscripción por destinatario: header estándar + variable del HTML.
        unsubscribe_url = build_unsubscribe_url(customer_name, email, tenant)
        del msg['List-Unsubscribe']
        del msg['List-Unsubscribe-Post']
        msg['List-Unsubscribe'] = f'<{unsubscribe_url}>'
        msg['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'

        if personalized_subject:
            for item in personalized_subjects_list:
                index = item["Index"]
                name = item["Name"]
                subject_new = subject_new.replace(name,data_list[index])
        msg['Subject'] = subject_new

        
        if personalized_body:
            for item in personalized_body_list:
                index = item["Index"]
                name = item["Name"]
                print(name)
                html_new = html_new.replace(name,data_list[index])
        
        #print(html_new)
        # Add body to email
        msg_body = MIMEMultipart('alternative')
        
        #htmlpart = MIMEText(html_new.encode('utf-8'), 'html', 'utf-8')
   
        if personalized_text:
            for item in personalized_text_list:
                index = item["Index"]
                name = item["Name"]
                text_new = text_new.replace(name,data_list[index])

        #textpart = MIMEText(text_new.encode(CHARSET), 'plain', CHARSET)
        #print(html_new)
        print("Prueba")


        # Reemplazar la variable de desuscripción en el cuerpo (el builder la
        # incluye en el pie de todas las plantillas).
        html_new = (html_new or "").replace('{{unsubscribeUrl}}', unsubscribe_url)
        text_new = (text_new or "").replace('{{unsubscribeUrl}}', unsubscribe_url)

        textpart = MIMEText(text_new or "", 'plain', 'utf-8')
        htmlpart = MIMEText(html_new or "", 'html', 'utf-8')

    
        
        
        msg_body.attach(textpart)
        msg_body.attach(htmlpart)
        
        msg.attach(msg_body)

        part = MIMEApplication(file_content)
        part.add_header('Content-Disposition', 'attachment', filename=file_name)
        msg.attach(part)

        print("Finaliza proceso de personalizacion de data")
        # Obtener la fecha y hora actual
        now = datetime.utcnow()
        # Formatear la fecha y hora según un formato específico
        formatted_date = now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + 'Z'
        # Envía el lote de correos electrónicos
        #Maximo 50 destinatarios o envios de email
        print("Ejecutando proceso de envio del bulk")
        print(f"Email: {email}")
        # Try to send the email.
        try:
            response = ses.send_raw_email(
                Source=from_email,
                Destinations=emails,
                RawMessage={'Data': msg.as_string()},
                Tags=tags,
                ConfigurationSetName="default"
            )
            print(response)
            
        # Display an error if something goes wrong.	
        except Exception as e:
            print(e)
        else:
            print("Email sent! Message ID:"),
            #print(response['MessageId'])

        print("Proceso de envio de bulk finalizado")
        #'Status':

        #msg.delete_all_attachments() 
        
        emails = []
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
        
        send_detail_id = response.get('MessageId', str(uuid.uuid4())+"-Error")
        error = response.get('Error', '')

        # Define los datos que deseas insertar (processId = PK de la tabla única).
        data_to_insert.append({
            'processId': {'S': process_id},
            'sendDetailId': {'S': send_detail_id},
            'processDetailId': {'S': process_detail_id},
            'uniqueId': {'S': unique_id},
            'email': {'S': email},
            'data': {'S': str(register)},
            'date': {'S': formatted_date}
        })
    print("Iniciando proceso de registro de estados")
    #Aca debo insertar los errores que se pudieran presentar
    insert_send_detail(data_to_insert)
    print("Fin de proceso de insert de estados")
    

def lambda_handler(event, context):
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
    global campaign_id
    global from_email
    global subject
    global process_detail_id
    global process_id
    global personalized_subject
    global personalized_body
    global personalized_text
    global personalized_subjects_list
    global personalized_body_list
    global personalized_text_list
    global html
    global text
    global file_content

    text = ""
    html = ""
    # Obtener la fecha y hora actual
    now = datetime.utcnow()
    # Formatear la fecha y hora según un formato específico
    formattedDate = now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + 'Z'
    process_detail_id = str(uuid.uuid4())

    try:
        # Obtener datos del evento
        body = event["Records"][0]["body"]
        json_body = json.loads(body)
        customer_id = json_body["customerId"]
        customer_name = json_body["customerName"]
        nit = json_body.get("nit")  # NIT → bucket S3 por NIT (fallback al viejo por nombre)
        tenant = tenant_key(nit)    # llave de las tablas por cliente ({tenant}_sendDetail, etc.)
        process_id = json_body["processId"]
        campaign_id = json_body["campaignId"]
        is_samples = bool(json_body.get("samples", False))  # muestras → contar al terminar OK
        attachment = json_body["attachment"]
        from_email = json_body["fromEmail"]
        headers = json_body["headers"]
        template_name = json_body["templateName"]
        part = json_body["part"]
        data = json_body["data"]
        registers = len(data)
        print(f"Customer: {customer_name}")
        print(f"Customer id: {customer_id}")
        print(f"Process id: {process_id}")
        print(f"Campaign id: {campaign_id}")
        print(f"From email: {from_email}")
        print(f"Headers: {headers}")
        print(f"Template name: {template_name}")
        print(f"Parte: {part}")
        print(f"Cantidad registros a procesar: {registers}")

    except Exception as e:
        print(e)
        status = False
        statusCode = 500
        description = "Error no controlado en el servicio"
    else:
        #El parametro DefaultTemplateData  lo puedo usar para el reemplazo de las url para adjuntos ONLINE
        #El cliente solo necesita cargar el adjunto a S3 (Mediante la creacion de la campa;a)
        #Despues debe poner en la plantilla de email un campo de reemplazo o varios campos de reemplazo asi:
        #{Adjunto1}, {Adjunto2}, {AdjuntoN}
        #Al crear la campa;a, el front debe validar que si exista la cantidad X de adjuntos segun los datos cargados a S3
        #Consultar la informacion de la plantilla

        # La idempotencia se hace por CHUNK en el bloque de envío (no a nivel de parte), para
        # poder REANUDAR un envío parcial sin reenviar los sub-lotes ya enviados (ver abajo).

        tags = [{
                "Name":"customer",
                "Value":customer_name
            },
            {
                # NIT saneado (tenant_key): ReceptionStatus reconstruye {tenant}_sendStatus con él.
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

        print(headers)
        file_content = get_attachments_data(customer_name,campaign_id,nit)
        header_list = headers

        response_template = select_template(template_name)
        subject = response_template["Template"]["SubjectPart"]
        html = response_template["Template"]["HtmlPart"]
        text = response_template["Template"].get("TextPart","")
        #print(text)
        #print(html)
        #sys.exit(1)
        #subject = "Envio para {{Nombre}}-{{Celular}}"
        print(f"Asunto: {subject}")
        patron = r'\{\{(.*?)\}\}'

        matches_subject = re.findall(patron, subject) 
        matches_body = re.findall(patron, html)
        matches_text = re.findall(patron, text)

        personalized_subject = False
        personalized_subjects_list = []
        if matches_subject:
            personalized_subject = True
            #Lista de campos personalizados sin los duplicados
            subject_matches_list = set(matches_subject)
            for item in subject_matches_list:
                if item in header_list:
                    index = header_list.index(item)
                    personalized_subjects_list.append({
                        "Index":index,
                        "Name":"{{" + item + "}}"
                    })
                else:
                    print(f'El campo "{item}" no se encuentra en la BD del cliente')
                    sys.exit(1)

        
        personalized_body = False
        personalized_body_list = []
        if matches_body:
            personalized_body = True
            #Lista de campos personalizados sin los duplicados
            body_matches_list = set(matches_body)
            for item in body_matches_list:
                print(item)
                if item in header_list:
                    index = header_list.index(item)
                    personalized_body_list.append({
                        "Index":index,
                        "Name":"{{" + item + "}}"
                    })
                else:
                    print(f'El campo "{item}" no se encuentra en la BD del cliente')
                    sys.exit(1)


        personalized_text = False
        personalized_text_list = []
        if matches_text:
            personalized_text = True
            #Lista de campos personalizados sin los duplicados
            text_matches_list = set(matches_text)
            for item in text_matches_list:
                if item in header_list:
                    index = header_list.index(item)
                    personalized_text_list.append({
                        "Index":index,
                        "Name":"{{" + item + "}}"
                    })
                else:
                    print(f'El campo "{item}" no se encuentra en la BD del cliente')
                    sys.exit(1)

        print("Antes del for")
        # Envío por CHUNKS con idempotencia + REANUDACIÓN (checkpoint intra-parte). Cada chunk
        # [start..end) se reclama de forma ATÓMICA (clave DETERMINISTA processId#part#send#{start}):
        # si ya fue enviado (otra entrega o un intento previo que falló más adelante), se OMITE. Si
        # la llamada a SES del chunk FALLA (no entregó nada), se LIBERA su claim y se RE-LANZA: la
        # redelivery de SQS reanuda EXACTAMENTE desde ese chunk, sin repetir los enviados ni perder
        # los pendientes. Antes, un fallo a mitad marcaba TODA la parte y la bloqueaba → pérdida de
        # los chunks siguientes. Favorece "sin duplicados": una caída DURA entre reclamar y enviar
        # deja ese único chunk (≤QUANTITY_BATCH) sin enviar.
        any_sent = False
        for start in range(0, registers, QUANTITY_BATCH):
            end = min(start + QUANTITY_BATCH, registers)
            chunk_len = end - start
            if not _claim_part(tenant, process_id, part, chunk_len, formattedDate, stage=f'send#{start}'):
                print(f"Chunk {start} de la parte {part} ya enviado; se omite (reanudación).")
                continue
            try:
                print(f"Procesando registros {start} a {end}")
                send_bulk(data, header_list, start, end, tags)
                any_sent = True
            except Exception as e:
                _release_part(tenant, process_id, part, stage=f'send#{start}')
                print(f"Error enviando el chunk {start} de la parte {part} del proceso {process_id}: {e}")
                raise

        print("Proceso de envios finalizado")
        # Muestras: contar 1 SOLO si esta invocación envió algo nuevo (any_sent evita recontar en
        # una redelivery donde todos los chunks ya estaban enviados).
        if is_samples and campaign_id and any_sent:
            count_sample_send(campaign_id)


def count_sample_send(campaign_id:str)->None:
    """Cuenta 1 envío de MUESTRA (atómico) en la campaña, SOLO cuando el envío salió bien.
    Ver Api_V1_Email_Send-batch-template-EM (mismo patrón)."""
    try:
        table_campaign.update_item(
            Key={'campaignId': campaign_id},
            UpdateExpression='SET samplesSentCount = if_not_exists(samplesSentCount, :z) + :one',
            ExpressionAttributeValues={':one': 1, ':z': 0})
        print('Envío de muestra contado en la campaña {}'.format(campaign_id))
    except Exception as e:
        print('No se pudo contar el envío de muestra: {}'.format(e))


def get_template(template:str)->dict:
    # Recuperar la plantilla de correo electrónico
    try:
        responseTemplate = ses.get_template(TemplateName=template)
        print("plantilla recuperada correctamente")
   
        return responseTemplate

    except Exception as e:
        print(e)
        print("No se pudo recuperar la plantilla")
    
    #Proceso de recuperacion mediante POST
    '''
    url = "https://api.mailconnect.com.co/v1/Template/Get-template"
    data = {
        "userId": "sdkjfk8hsdf",
        "templateName": template
    }
    response = requests.post(url,data)


    if response.status_code == 200:
        # La solicitud fue exitosa
        jsonResponse = response.json()
        subject = jsonResponse.template.SubjectPart
        html = jsonResponse.template.htmlPart
         
    else:
        # La solicitud falló
        print("statusCode: " + response.status_code)
    '''      

