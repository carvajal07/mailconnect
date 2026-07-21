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

global customer_name
global tenant
global template_name
global from_email
global process_detail_id
global process_id

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

def count_sample_send(campaign_id:str)->None:
    """Cuenta 1 envío de MUESTRA (atómico) en la campaña, SOLO cuando el envío salió bien.
    Se llama desde el worker tras un envío exitoso (no en Prepare-batch), para que una
    muestra que se prepara pero NO se entrega no consuma el cupo (MAX_SAMPLE_SENDS).
    Idempotente en la práctica: el worker deduplica por parte (validate_process_detail),
    así que una redelivery de SQS no vuelve a contar."""
    try:
        table_campaign.update_item(
            Key={'campaignId': campaign_id},
            UpdateExpression='SET samplesSentCount = if_not_exists(samplesSentCount, :z) + :one',
            ExpressionAttributeValues={':one': 1, ':z': 0})
        print('Envío de muestra contado en la campaña {}'.format(campaign_id))
    except Exception as e:
        print('No se pudo contar el envío de muestra: {}'.format(e))


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
    response = ses.send_bulk_templated_email(
        Source=from_email,
        Template=template_name,
        ConfigurationSetName="default",
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
    global template_name
    global from_email
    global process_detail_id
    global process_id

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
        headers = json_body["headers"]
        template_name = json_body["templateName"]
        part = json_body["part"]
        data = json_body["data"]
        registers = len(data)
        print(f"Cantidad registros a procesar: {registers}")
        
        #Validar el estado de la parte a procesar (Si se encuentra procesando o terminada puede ser un error de mensajes duplicados)
        #Debo generar error para evitar realizar envios duplicados
        response_process_detail = validate_process_detail(part)
        if response_process_detail['Items']:
            state = response_process_detail['Items'][0]["stateProcess"]
            print(f"La parte {part} del proceso {process_id} ya se encuentra procesando o ha finalizado")
            print(f"El id: {process_detail_id} se encuentra en estado {state}")
            raise ValueError("La parte ya ha sido procesada")
        print("Inicia actualización del estado a procesando")
        insert_process_detail(registers,part,formatted_date,"Procesando")
    except Exception as e:
        print(e)
        print("Error en la lectura de los datos de entrada")

    else:
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

        # Envío de los lotes de la parte. Antes iba SIN try: si send_bulk fallaba a mitad
        # (plantilla inexistente, cuenta pausada, throttling, config set faltante…) la parte
        # quedaba en 'Procesando' (parecía en curso para siempre) y sin señal clara. Ahora
        # se marca 'Error' (traza honesta) y se RE-LANZA para que la invocación falle de
        # forma visible (métrica de error / DLQ). NO se habilita el reenvío automático: el
        # guard de estado descarta la redelivery, evitando duplicar los correos ya enviados
        # (un envío duplicado dispara quejas y daña la reputación SES). La parte en 'Error'
        # se reintenta manualmente (Trabajos → Reintentar).
        try:
            for start in range(0, registers, QUANTITY_BATCH):
                end = start + QUANTITY_BATCH
                print(f"Procesando registros {start} a {end}")
                send_bulk(data, headers, start, end, default_tags)
        except Exception as e:
            print(f"Error enviando la parte {part} del proceso {process_id}: {e}")
            insert_process_detail(registers, part, formatted_date, "Error")
            raise

        print("Proceso de envios finalizado")
        insert_process_detail(registers,part,formatted_date,"Terminado")
        # Envío de MUESTRAS terminado OK → contar 1 en la campaña (no cuenta si falla antes).
        if is_samples and campaign_id:
            count_sample_send(campaign_id)
