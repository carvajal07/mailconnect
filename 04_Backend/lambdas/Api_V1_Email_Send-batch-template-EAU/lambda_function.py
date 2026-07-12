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


def tenant_bucket(nit, doc_type):
    clean = re.sub(r'[^a-z0-9]', '', str(nit or '').lower())
    return '{}-{}-{}'.format(BUCKET_PREFIX, clean, doc_type)

# Desuscripción: URL de la lambda Unsubscribe y clave para firmar el token.
# En EAU el correo es MIME crudo, así que además del enlace en el HTML
# ({{unsubscribeUrl}}) se agrega el header estándar List-Unsubscribe (RFC 8058).
UNSUBSCRIBE_URL = os.environ.get('UNSUBSCRIBE_URL', 'https://api.mailconnect.com.co/V1/Email/Unsubscribe')
SECRET_KEY = os.environ.get('SECRET_KEY', '')


def build_unsubscribe_url(customer, email):
    """Token firmado (HMAC-SHA256) que la lambda Unsubscribe valida."""
    payload = json.dumps({'c': customer, 'e': email}, separators=(',', ':'))
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

def insert_processDetail(processDetailId,customerName,processId,registers,part,date,state):
    #debo contar los registros del array data para poner ese valor en el campo total de la tabla {customer}_processDetail
    table_processDetail = dynamodb.Table(f'{customerName}_processDetail')
    
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

def insert_send_detail(data:dict)->None:
    """
    Función encargada de insertar los detalles de cada envio a la base de datos.

    Args:
        data (dict): Diccionario con la información de los detalles para insertar
        
    Returns:
        None: No retorna resultados
    """

    table_name = f'{customer_name}_sendDetail_{process_id}'
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
                # Descargar el objeto S3 en un objeto BytesIO
                file_name = attachment_path.split('/')[1]

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
        unsubscribe_url = build_unsubscribe_url(customer_name, email)
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

        # Define los datos que deseas insertar
        data_to_insert.append({
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

    global customer_name
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
    html = """
    <!doctype html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="utf-8">
    <title>Mercacaldas Octubre 2025</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <!-- Evita auto-escala en iOS -->
    <meta name="x-apple-disable-message-reformatting">
    <!-- For Outlook -->
    <!--[if mso]>
      <style type="text/css">
        body, table, td {font-family: Arial, sans-serif !important;}
      </style>
    <![endif]-->
    <style>
      /* Reseteos mínimos para clientes modernos */
      img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
      table { border-collapse:collapse; }
      a { text-decoration:none; }
      /* Dark mode hint */
      @media (prefers-color-scheme: dark) {
        body { background:#111111 !important; }
      }
    </style>
  </head>
  <body style="margin:0; padding:0; background:#f3f4f6;">
    <!-- Preheader (invisible en la mayoría de clientes) -->
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">
      Mercacaldas – Campaña Octubre 2025
    </div>

    <!-- Contenedor -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" align="center" style="background:#f3f4f6;">
      <tr>
        <td align="center" style="padding:20px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:600px; max-width:100%; background:#ffffff;">
            <tr>
              <td style="padding:0; line-height:0;">
                <!-- Imagen hero -->
                <a href="https://s3.us-east-1.amazonaws.com/merkacaldas.resources/MerkacaldasOctubre2025.jpeg" target="_blank">
                  <img 
                    src="https://s3.us-east-1.amazonaws.com/merkacaldas.resources/MerkacaldasOctubre2025.jpeg"
                    width="600"
                    alt="Mercacaldas Octubre 2025"
                    style="display:block; width:100%; height:auto; border:0; outline:0; text-decoration:none;">
                </a>
              </td>
            </tr>

            <!-- Texto alterno/fallback por si bloquean imágenes -->
            
            <tr>
              <td style="padding:16px 20px 24px 20px; font-family:Arial,Helvetica,sans-serif; color:#111827; font-size:14px; line-height:1.5;">
                Conoce todas las promociones, regalos y descuentos <a href="https://s3.us-east-1.amazonaws.com/merkacaldas.document/2025-10-17/PromocionesAniversario.pdf" style="color:#0ea5e9;">aquí</a>.
              </td>
            </tr>
            <tr>
              <td style="padding:16px 20px 24px 20px; font-family:Arial,Helvetica,sans-serif; color:#111827; font-size:14px; line-height:1.5;">
                Si no ves la imagen, puedes <a href="https://s3.us-east-1.amazonaws.com/merkacaldas.resources/MerkacaldasOctubre2025.jpeg" style="color:#0ea5e9;">abrirla aquí</a>.
              </td>
            </tr>

            <!-- Pie -->
            <tr>
              <td style="padding:0 20px 20px 20px; font-family:Arial,Helvetica,sans-serif; color:#6b7280; font-size:12px; line-height:1.5;">
                © 2025 Merkacaldas. Todos los derechos reservados.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
    """
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
        process_id = json_body["processId"]
        campaign_id = json_body["campaignId"]
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

        
        tags = [{
                "Name":"customer",
                "Value":customer_name
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
        #html = response_template["Template"]["HtmlPart"]
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
        for start in range(0, registers, QUANTITY_BATCH):
            print("En el for")
            end = min(start + QUANTITY_BATCH, registers)
            print(f"Procesando registros {start} a {end}")
            send_bulk(data, header_list, start, end, tags)
            #send_bulk(data, header_list, from_email, subject, file_content, personalized_text, personalized_subject, personalized_body, personalized_body_list, html, text, start, end, tags)

        
        
        #Consultar informacon de los adjuntos
        

        insert_processDetail(process_detail_id,customer_name,"asd",999,1,formattedDate,"Estado")
        table_sendDetail = dynamodb.Table(f'{customer_name}_sendDetail')
        
        
    
        print("Proceso de envios finalizado")
        #insert_process_detail(registers,part,formatted_date,"Terminado")

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

