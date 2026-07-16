'''
Lambda para realizar el envio de emails en lotes (Email con adjunto personalizado)
'''
import os
import boto3
import uuid
import json
import sys
import hmac
import base64
import hashlib
from datetime import datetime, timedelta
import re
from botocore.exceptions import ClientError
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication

REGION = 'us-east-1'

# Bucket por cliente por NIT: {prefix}-{nit}-document (DNS-safe). Fallback al viejo por nombre.
BUCKET_PREFIX = os.environ.get('BUCKET_PREFIX', 'mailconnect')


def tenant_key(nit):
    """Llave de tenant (NIT saneado) para las tablas por cliente. Igual que en Prepare-batch
    y en los buckets S3. Idempotente."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def tenant_bucket(nit, doc_type):
    return '{}-{}'.format(BUCKET_PREFIX, tenant_key(nit))


# Desuscripción: igual que EM/EAU. El builder SIEMPRE inserta {{unsubscribeUrl}} en el
# HTML; aquí se rellena POR DESTINATARIO (token HMAC firmado que valida la lambda
# Unsubscribe) y, como el correo es MIME crudo (send_raw_email), se agrega además el header
# estándar List-Unsubscribe (RFC 8058). Antes EAP no reemplazaba la variable → llegaba el
# literal {{unsubscribeUrl}} al destinatario.
UNSUBSCRIBE_URL = os.environ.get('UNSUBSCRIBE_URL', 'https://api.mailconnect.com.co/V1/Email/Unsubscribe')
SECRET_KEY = os.environ.get('SECRET_KEY', '')


def build_unsubscribe_url(customer, email, tenant=''):
    """Token firmado (HMAC-SHA256) que la lambda Unsubscribe valida (mismo formato que EAU).
    `tenant` (llave por NIT) viaja como 'n' → Unsubscribe nombra {tenant}_unsubscribe."""
    payload = json.dumps({'c': customer, 'e': email, 'n': tenant}, separators=(',', ':'))
    payload_b64 = base64.urlsafe_b64encode(payload.encode()).decode().rstrip('=')
    signature = hmac.new(SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()[:32]
    return "{}?t={}.{}".format(UNSUBSCRIBE_URL, payload_b64, signature)


global customer_name
global tenant
global process_id
global custom_fields_pattern


#Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')

#Crea un cliente de SES
ses = boto3.client('ses', region_name=REGION)

#Crea el cliente para S3
s3 = boto3.client('s3', region_name=REGION)

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



table_document = dynamodb.Table('document')
table_campaign = dynamodb.Table('campaign')

def insert_processDetail(process_detail_id,customer_name,registers,part,date,state):
    #cuenta los registros para el campo total de la tabla {tenant}_processDetail (tenant=tenant_key(NIT))
    table_processDetail = dynamodb.Table(f'{tenant}_processDetail')
    
    # Insertar datos en la tabla de detalle de procesos
    table_processDetail.put_item(
        Item={
            'processDetailId': process_detail_id,
            'processId': process_id,
            'registers': registers,
            'part': part,
            'date': date,
            'stateProcess': state
        }
    )

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

def insert_sendDetail(processDetailId,customerName,registers,part,date,state):
    #cuenta los registros para el campo total de la tabla {tenant}_processDetail (tenant=tenant_key(NIT))
    tableName = f'{tenant}_processDetail'
    
    # Define los datos que deseas insertar
    data_to_insert = [
        {
            'id': {'N': '1'},
            'nombre': {'S': 'Ejemplo1'},
            # Añade más atributos y sus valores según la estructura de tu tabla
        },
        {
            'id': {'N': '2'},
            'nombre': {'S': 'Ejemplo2'},
            # Añade más atributos y sus valores según la estructura de tu tabla
        }
    ]

    # Realiza la inserción en lotes utilizando el método batch_write_item
    with dynamodb.batch_write_item(RequestItems={tableName: [{'PutRequest': {'Item': item}} for item in data_to_insert]}) as response:
        pass  # La inserción se realiza en el bloque 'with'

    # Verifica si hubo errores en la inserción
    if response.get('UnprocessedItems'):
        print('Hubo elementos no procesados:', response['UnprocessedItems'])
    else:
        print('Todos los elementos se insertaron correctamente.')

def get_attachment(campaignId):
    projectionDocument_expression = 'documentPath,attachmentType'  # Lista de campos a consultar

    responseDocument = table_document.scan(
        FilterExpression="campaignId = :value",
        ExpressionAttributeValues={":value": campaignId},
        ProjectionExpression=projectionDocument_expression
    )
    return responseDocument

def get_template(template:str)->dict:
    # Recuperar la plantilla de correo electrónico
    try:
        response_template = ses.get_template(TemplateName=template)
        print("plantilla recuperada correctamente")
   
        return response_template

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

def personalized_data(custom_fields,register,personalized_text):
    for custom_field in custom_fields:
        index = custom_field["Index"]
        #key = re.sub(replace_pattern, "", custom_field)
        name = custom_field["Name"]
        #value = str(register[key])
        personalized_text = personalized_text.replace(name,register[index])
    return personalized_text

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
    global process_id

    status = True
    description = "Campaña enviandose correctamente"
    status_code = 200

    subject = ""
    text = ""
    html = ""
    
    #utc_now = datetime.datetime.utcnow()
    #bogota_timezone = timezone('America/Bogota')
    #colombia_now = utc_now.astimezone(bogota_timezone)
    # Obtener la fecha y hora actual
    now = datetime.utcnow()
    colombia_time = now - timedelta(hours=5)
    # Formatear la fecha y hora según un formato específico
    formatted_date = colombia_time.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + 'Z'
    print(formatted_date)
    process_detail_id = str(uuid.uuid4())
    
    
    try:
        #Entrada de body
        '''
        {
            "customerId":"customerId",
            "customerName":"customerName",
            "processId":"processId",
            "attachment":false,
            "headers":"headers",
            "templateName":"templateName",
            "part":1,
            "data":"data"
        }
        '''

        # Obtener datos del evento
        body = event["Records"][0]["body"]
        json_body = json.loads(body)
        customer_id = json_body["customerId"]
        customer_name = json_body["customerName"]
        nit = json_body.get("nit")  # NIT → bucket S3 por NIT (fallback al viejo por nombre)
        tenant = tenant_key(nit)    # llave de las tablas por cliente ({tenant}_sendDetail, etc.)
        print("Customer" + customer_name)
        process_id = json_body["processId"]
        campaign_id = json_body["campaignId"]
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
        
        #Validar el estado de la parte a procesar (Si se encuentra "Realizando envios" puede ser un error de mensajes duplicados)
        #Debo generar error para evitar realizar envios duplicados
        response_process_detail = validate_process_detail(part)
        if response_process_detail['Items']:
            state = response_process_detail['Items'][0]["stateProcess"]
            if (state == "Realizando envios"):
                print(f"La parte {part} del proceso {process_id} ya se encuentra realizando los envios")
                print(f"El id: {process_id} se encuentra en estado {state}")
                raise ValueError("La parte ya ha sido procesada")
        print("Inicia actualización del estado a Realizando envios")
        #insert_processDetail(process_detail_id,customer_name,registers,part,formatted_date,"Realizando envios")

        #Consultar la informacion de la plantilla
        response_template = get_template(template_name)
        print(response_template)
        subject = response_template["Template"]["SubjectPart"]
        print(subject)
        subject = "Asunto de prueba {{Identificacion}}"
        
        html = response_template["Template"]["HtmlPart"]
        print(html)
        
        text = response_template["Template"].get('textPart','')
        print(f"text:{text}")

        
        table_sendDetail = dynamodb.Table(f'{tenant}_sendDetail')

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
        #Si son varios adjuntos no pueden ser de diferente tipo (ONLINE; ONFILE)
        #Por aca solo debrian pasar los email con adjunto ONFILE, los ONLINE deben ir en email marketing

        default_tags = [{
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
        custom_fields_pattern = r'{{.*?}}'
        replace_pattern = r"{{|}}"
        missing_custom_field = []
        #custom_fields_pattern = re.compile(r'{{.*?}}')
        matches_subject = re.findall(custom_fields_pattern, subject) 
        matches_body = re.findall(custom_fields_pattern, html)
        matches_text = re.findall(custom_fields_pattern, text)

        personalized_subject = False
        personalized_subjects_list = []
        if matches_subject:
            print("Inicio busqueda campos personalizacion del asunto")
            personalized_subject = True
            #Lista de campos personalizados sin los duplicados
            subject_matches_list = set(matches_subject)
            print(subject_matches_list)
            for item in subject_matches_list:
                item = re.sub(replace_pattern, "", item)
                if item in headers:
                    index = headers.index(item)
                    personalized_subjects_list.append({
                        "Index":index,
                        "Name":"{{" + item + "}}"
                    })
                else:
                    print(f'El campo "{item}" no se encuentra en la BD del cliente')
                    missing_custom_field.append(item)

        
        personalized_body = False
        personalized_body_list = []
        if matches_body:
            print("Inicio busqueda campos personalizacion del body")
            personalized_body = True
            #Lista de campos personalizados sin los duplicados
            body_matches_list = set(matches_body)
            print(body_matches_list)
            for item in body_matches_list:
                item = re.sub(replace_pattern, "", item)
                print(item)
                if item in headers:
                    index = headers.index(item)
                    personalized_body_list.append({
                        "Index":index,
                        "Name":"{{" + item + "}}"
                    })
                else:
                    print(f'El campo "{item}" no se encuentra en la BD del cliente')
                    missing_custom_field.append(item)


        personalized_text = False
        personalized_text_list = []
        if matches_text:
            print("Inicio busqueda campos personalizacion del text")
            personalized_text = True
            #Lista de campos personalizados sin los duplicados
            text_matches_list = set(matches_text)
            print(text_matches_list)
            for item in text_matches_list:
                item = re.sub(replace_pattern, "", item)
                if item in headers:
                    index = headers.index(item)
                    personalized_text_list.append({
                        "Index":index,
                        "Name":"{{" + item + "}}"
                    })
                else:
                    print(f'El campo "{item}" no se encuentra en la BD del cliente')
                    missing_custom_field.append(item)

        if (missing_custom_field):
            print("Campos faltantes: " + str(missing_custom_field))
            #sys.exit(1)
        print(f"Encabezados de personalizacion ({headers})")
        bucket_name = tenant_bucket(nit, 'document') if nit else f'{customer_name.lower()}.document'
        
        #custom_fields_pattern = r'{{.*?}}'
        replace_pattern = r"{{|}}"
        #custom_subject_fields = re.findall(custom_fields_pattern, subject)
        #print(custom_subject_fields)
        #custom_body_fields = re.findall(custom_fields_pattern, html)
        #print(custom_body_fields)
        #quantity_custom_fields = len(custom_subject_fields)

        if personalized_subject:
            print("Proceso sin personalizacion del asunto")
        
            for register in data: 
                # Preparar la lista de adjuntos  
                personalized_subject = personalized_data(personalized_subjects_list,register,subject)
                print(f"Asunto: {personalized_subject}")
                unique_id = register[0]
                email = register[1]
                #Temporal
                doc_name = register[0] + ".docx"
                #Productivo
                #doc_name = register[2] + ".docx"
                print(f"Email: {email} - Pdf: {doc_name}")
                attachmentPath = f'attachment/{campaign_id}/{doc_name}'
                s3_object = s3.get_object(Bucket=bucket_name, Key=attachmentPath)
                file_content = s3_object['Body'].read()
                #file_object = file_content.decode('ISO-8859-1')
                #file_object = BytesIO(file_content)
                print("Plantilla de adjunto descargada correctamente")
                #Reemplazar variables en HTML
                personalized_body = personalized_data(personalized_body_list,register,html)
                personalized_text = personalized_data(personalized_text_list,register,text)
                # Desuscripción por destinatario (token firmado) + header List-Unsubscribe.
                unsubscribe_url = build_unsubscribe_url(customer_name, email, tenant)
                personalized_body = (personalized_body or "").replace('{{unsubscribeUrl}}', unsubscribe_url)
                personalized_text = (personalized_text or "").replace('{{unsubscribeUrl}}', unsubscribe_url)
                '''
                for field_body in custom_body_fields:
                    key = re.sub(replace_pattern, "", field_body)
                    value = str(register[key])
                    personalized_body = personalized_body.replace(field_body,value)
                    personalized_text = personalized_text.replace(field_body,value)
                '''

                msg = MIMEMultipart('mixed')
                msg['Subject'] = personalized_subject
                msg['List-Unsubscribe'] = f'<{unsubscribe_url}>'
                msg['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'


                # Add body to email
                msg_body = MIMEMultipart('alternative')
                textpart = MIMEText(personalized_text.encode('utf-8'), 'plain', 'utf-8')
                htmlpart = MIMEText(personalized_body.encode('utf-8'), 'html', 'utf-8')
                msg_body.attach(textpart)
                msg_body.attach(htmlpart)
                msg.attach(msg_body)


                #Agregar adjunto
                part = MIMEApplication(file_content)
                part.add_header('Content-Disposition', 'attachment', filename=os.path.basename(doc_name))
                msg.attach(part)

                
                # Try to send the email.
                try:
                    response = ses.send_raw_email(
                        Source=from_email,
                        Destinations=[email],
                        ConfigurationSetName="default",
                        Tags=default_tags,
                        RawMessage={'Data': msg.as_string()}
                    )
                    print(response)
                    '''
                    response->
                    {
                        'MessageId': 'string'
                    }
                    '''
                except Exception as e:
                    print(e)
        else:
            print("Proceso con personalizacion del asunto")
            for register in data: 
                
                '''
                for field_subject in custom_subject_fields:
                    key = re.sub(replace_pattern, "", field_subject)
                    value = str(register[key])
                    personalized_subject = personalized_subject.replace(field_subject,value)
                '''
                
                # Preparar la lista de adjuntos 
                unique_id = register[0]
                email = register[1]
                doc_name = register[2] + ".docx"
                attachmentPath = f'attachment/{campaign_id}/{doc_name}'
                s3_object = s3.get_object(Bucket=bucket_name, Key=attachmentPath)
                print("consulta adjunto ejecutada correctamente")
                file_content = s3_object['Body'].read()
                file_object = file_content.decode('ISO-8859-1')
                #file_object = BytesIO(file_content)

                #Reemplazar variables en HTML
                personalized_body = personalized_data(personalized_body_list,register,html)
                print(personalized_body)
                personalized_text = personalized_data(personalized_text_list,register,text)
                print(personalized_text)
                # Desuscripción por destinatario (token firmado) + header List-Unsubscribe.
                unsubscribe_url = build_unsubscribe_url(customer_name, email, tenant)
                personalized_body = (personalized_body or "").replace('{{unsubscribeUrl}}', unsubscribe_url)
                personalized_text = (personalized_text or "").replace('{{unsubscribeUrl}}', unsubscribe_url)
                '''
                for field_body in custom_body_fields:
                    key = re.sub(replace_pattern, "", field_body)
                    value = str(register[key])
                    personalized_body = personalized_body.replace(field_body,value)
                    personalized_text = personalized_text.replace(field_body,value)
                '''

                msg = MIMEMultipart('mixed')
                msg['Subject'] = personalized_subject
                msg['List-Unsubscribe'] = f'<{unsubscribe_url}>'
                msg['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'


                # Add body to email
                msg_body = MIMEMultipart('alternative')
                textpart = MIMEText(personalized_text.encode('utf-8'), 'plain', 'utf-8')
                htmlpart = MIMEText(personalized_body.encode('utf-8'), 'html', 'utf-8')
                msg_body.attach(textpart)
                msg_body.attach(htmlpart)
                msg.attach(msg_body)
                print("Se agrego el body al mensaje")

                #Agregar adjunto
                part = MIMEApplication(file_object)
                part.add_header('Content-Disposition', 'attachment', filename=os.path.basename(doc_name))
                msg.attach(part)

                
                # Try to send the email.
                try:
                    response = ses.send_raw_email(
                        Source=from_email,
                        Destinations=[email],
                        ConfigurationSetName="default",
                        Tags=default_tags,
                        RawMessage={'Data': msg.as_string()}
                    )
                    '''
                    response->
                    {
                        'MessageId': 'string'
                    }
                    '''
                except Exception as e:
                    #Si alguno de los envios no se puede realizar debo enviarlo a una cola para darle manejo
                    print(e)
                

        

    finally:
        # Respuesta
        response = {
            'status':status,
            'statusCode': status_code,
            'description':description
        }

    return response