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

URL_SQS_EM = 'https://sqs.us-east-1.amazonaws.com/873837768806/Email_Send-batch-template-EM'
URL_SQS_EAU = 'https://sqs.us-east-1.amazonaws.com/873837768806/Email_Send-batch-raw-EAU'
#URL_SQS_EAP = 'https://sqs.us-east-1.amazonaws.com/873837768806/Email_Send-batch-raw-EAP'
URL_SQS_EAP = 'https://sqs.us-east-1.amazonaws.com/873837768806/Template_Combination-EAP'
REGION = 'us-east-1'
DELIMITER = ';'
ENCODING = 'utf-8'

global process_id
global campaign_id
global customer_id
global customer_name
global formatted_date
global from_email
global headers
global template_name
global attachment

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

message:str = ""
body:str = ""
messages = []
global_counter_message:int

registers_for_message:int = 0
samples:bool = False
invalid_mail:bool = False
invalid_mails:str = ""


def insert_process(campaign_name:str,user_id:str,registers_on_spool:int,registers_to_send:int,quantity_blacklist:int,quantity_unsubscribe:int,quantity_deletions:int,parts:int,template_version:int,state:str)->None:
    """
    Esta función inserta los datos del proceso completo, con sus cantidades.

    Args:
        process (str): En el campo proceso se inserta el nombre de la campaña
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
            'processId': process_id,
            'customerName': customer_name,
            'campaignName': campaign_name,
            'campaignId': campaign_id,
            'userId': user_id,
            'registersOnSpool': registers_on_spool,
            'registersToSend': registers_to_send,
            'quantityBlacklist': quantity_blacklist,
            'quantityUnsubscribe': quantity_unsubscribe,
            'quantityDeletions': quantity_deletions,
            'parts': parts,
            'templateVersion': template_version,
            'date': formatted_date,
            'processState': state
        }
    )

def update_campaign_status(state:str)->None:
    """
    Esta función realiza la actualizacion del estado de la campaña.

    Args:
        status (str): Estado de la campaña

    Returns:
        None: No retorna resultados
    """
    response_update_campaign_status = table_campaign.update_item(
        Key={'campaignId':campaign_id},
        UpdateExpression='SET campaignState = :s',
        ExpressionAttributeValues={':s': state},
        ReturnValues='UPDATED_NEW'
    )
    print(response_update_campaign_status['Attributes'])

def select_campaign(campaign_name:str)->dict:
    """
    Esta función obtiene los datos de la campaña.

    Args:
        campaign_name (str): Nombre de la campana

    Returns:
        dict: Nombre de la campaña
    """
    projection_campaign_expression = 'campaignId, customerId, consecutive, channel, dataPath, campaignState, originEmail'  # Lista de campos a consultar

    response_campaign = table_campaign.scan(
        FilterExpression="campaignName = :value",
        ExpressionAttributeValues={":value": campaign_name},
        ProjectionExpression=projection_campaign_expression
    )
    return response_campaign

def prepare_message(data:str,part:int)-> list:
    """
    Esta función crea el body con la data necesaria para enviar a SQS

    Args:
        data (str): String con la data separada por punto y coma
        part (str): Numero de parte

    Returns:
        list: Lista con el append de cada mensaje de SQS
    """ 
    epoch_time = int(round(time.time() * 1000))
    #epoch_timestamp = time.time() - 621673600
    try:
        body = {
            "customerId":customer_id,
            "customerName":customer_name,
            "processId":process_id,
            "campaignId":campaign_id,
            "attachment":attachment,
            "fromEmail":from_email,
            "headers":headers,
            "templateName":template_name,
            "part":part,
            "data":data
        }
        json_string = json.dumps(body)
        '''
        message = {
            "Id":str(epoch_time),
            "MessageBody":str(body)
        }
        #Para colas fifo
        
        message = {
            "Id":str(part),
            "MessageBody":str(body),
            "MessageGroupId": "my-message-group-id",  # Optional: Use a message group ID for message ordering
            "MessageDeduplicationId": "my-deduplication-id-1",  # Optional: Use a message deduplication ID to prevent duplicates
        }
        '''
        
        #messages.append(message)
        
    except Exception as e:
        print(e)
    #return messages
    #return str(body)
    return json_string

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
    try:
        response = sqs.send_message_batch(
            QueueUrl=url_sqs,
            Entries=messages
        )
        print(response)
        print("Mensaje enviado")
    except Exception as e:
        print(e)

    #Validar la posibilidad de reintentos si no se puede encolar

def send_sqs(url_sqs:str,message:list)->None:
    """
    Esta función realiza el envio a las colas de SQS.

    Args:
        url_sqs (str): Url de la cola SQS en AWS
        messages (list): Lista con los mensajes (Maximo 10)

    Returns:
        dict: Nombre de la campaña
    """

    try:
        response = sqs.send_message(
            QueueUrl=url_sqs,
            MessageBody=message
        )
        print(response)

    except Exception as e:
        print(e)

    #Validar la posibilidad de reintentos si no se puede encolar

#Funcion no se usa en este proceso
def search_samples(file_in:str,samples:str,recipients:str,quantity_samples:int,quantity_recipients:int)->list:
    """
    Esta función obtiene los datos de la campaña.

    Args:
        campaign_name (str): Nombre de la campana

    Returns:
        dict: Nombre de la campaña
    """
    records_found = []
    samples_Count = 0
    index_recipient = 0
    print(samples)
    with open(file_in, 'r') as file:
        reader = csv.reader(file, delimiter=DELIMITER)
        next(reader) #Omito la primer linea que pertenece al encabezado
        for line in reader:
        #for line in file:
            #Reviso si ya asigne la cantidad total de muestras para no seguir recorriendo las lineas
            if samples_count == quantity_samples:
                break
            id = int(line[0])
            #print(id)

            #V1
            for sample in samples:
                print(sample)
                if id == sample:
                    samples_count += 1
                    print("Entro")
                    #Reemplazar email real
                    if index_recipient == quantity_recipients:
                        index_recipient = 0
                    #Reemplazar el email real por el email de muestras
                    new_email = recipients[index_recipient]
                    real_email = line[1]
                    line = line.replace(real_email,new_email)
                    records_found.append(line)
                    index_recipient += 1
                    break

            #V2
            if id in samples:
                samples_count += 1
                print("Entro")
                #Reemplazar email real
                if index_recipient == quantity_recipients:
                    index_recipient = 0
                #Reemplazar el email real por el email de muestras
                new_email = recipients[index_recipient]
                real_email = line[1]
                line = line.replace(real_email,new_email)
                records_found.append(line)
                index_recipient += 1
    return records_found

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

def get_blacklist_emails() -> set:
    table_blacklist = dynamodb.Table('cliente_blacklist')
    response = table_blacklist.scan(ProjectionExpression='email')
    return set(item['email'] for item in response['Items'])

def filtrar_emails_validos(lista_emails: list[str], blacklist: set[str]) -> list[str]:
    return [email for email in lista_emails if email not in blacklist]

def check_blacklist(keys:list)->list:
    """
    Esta función se encarga de consultar los email en la lista negra del cliente

    Args:
        keys (list): lista de llaves con los email a consultar

    Returns:
        list: Retorna la lista con los email que estan en la lista negra del cliente
    """
    # Realizar una consulta a la tabla de lista negra
    table_blacklist = dynamodb.Table(f'{customer_name}_blacklist')
    request_items = {
        'blacklist': {
            'Keys': keys
        }
    }

    # Realizar la consulta BatchGetItem
    response = table_blacklist.batch_get_item(RequestItems=request_items)

    # Obtener los correos electrónicos que están en la lista negra
    blacklisted_emails = set()
    for item in response.get('Responses', {}).get('blacklist', []):
        blacklisted_emails.add(item['email'])

    return blacklisted_emails

def check_unsubscribes(keys:list)->list:
    """
    Esta función se encarga de traer todos los registros que se encuentran en la tabla de desinscritos del cliente.

    Args:
        keys (list): lista con los email a consultar en la tabla

    Returns:
        list: Lista con los email desinscritos
    """
    # Realizar una consulta a la tabla de unsubscribes
    # Construir la solicitud BatchGetItem

    table_unsubscribe = dynamodb.Table(f'{customer_name}_unsubscribe')
    request_items = {
        table_unsubscribe: {
            'Keys': keys
        }
    }

    # Realizar la consulta BatchGetItem
    response = table_unsubscribe.batch_get_item(RequestItems=request_items)

    # Obtener los correos electrónicos que están en la lista de unsubscribes
    unsubscribed_emails = set()
    for item in response.get('Responses', {}).get(table_unsubscribe, []):
        unsubscribed_emails.add(item['email'])

    return unsubscribed_emails

def insert_mails_status(emails:list,state:str,description:str)->None:
    """
    Función encargada de insertar los detalles de cada envio a la base de datos con su respectivo estado. Aplica solo para desinscritos y lista negra

    Args:
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

        #data_list = register.split(";")
        #unique_id = data_list[0]
        #email = data_list[1]

        unique_id = register[0]
        email = register[1]

        #Data para insertar en los datos de envios
        data_to_insert_send_detail.append({
            'sendDetailId': id,
            'processDetailId': id,
            'uniqueId': unique_id,
            'email': email,
            'data': register,
            'date': formatted_date
        })

        #Data para insertar en los estados
        data_to_insert_send_status.append({
            'sendStatusId': id,
            'sendDetailId': id,
            'date': formatted_date,
            'state': state,
            'type1': description,
            'type2': description
        })

    table_name_details = f'{customer_name}_sendDetail_{process_id}'
    #table_name_details = f'{customer_name}_sendDetail_9540e04c-7f00-4499-8e80-1ab15bea968f'
    table_details = dynamodb.Table(table_name_details)

    #Almacena en bufer la data para hacer el insert por batch y maneja internamente los reintentos de elementos no procesados
    with table_details.batch_writer() as batch:
        for item in data_to_insert_send_detail:
            batch.put_item(Item=item)

    table_name_status= f'{customer_name}_sendStatus_{process_id}'
    table_status = dynamodb.Table(table_name_status)

    with table_status.batch_writer() as batch:
        for item in data_to_insert_send_status:
            batch.put_item(Item=item)
    end_time = time.time()
    tiempo = (end_time - start_time) * 1000
    print(f"{tiempo:.2f} milisegundos")    

def insert_mails_blacklist(emails:list,state:str,description:str)->None:
    """
    Función encargada de insertar los detalles de cada envio a la base de datos con su respectivo estado. Aplica solo para los registros con error en la estructura del email

    Args:
        emails (list): Lista con los email con error en la estructura que se van a insertar a la base de datos
        state (str): Estado 11 (Email invalido)
        description (str): Descripcion de email invalido
        
    Returns:
        None: No retorna resultados
    """
    data_to_insert_blacklist = []
    data_to_insert_send_detail = []
    data_to_insert_send_status = []
    # Define los datos que deseas insertar
    for register in emails:
        id = str(uuid.uuid4())

        #data_list = register.split(";")
        #unique_id = data_list[0]
        #email = data_list[1]

        unique_id = register[0]
        email = register[1]
        
        #Data para insertar en la lista negra
        data_to_insert_blacklist.append({
            'blacklistId': {'S': id},
            'date': {'S': formatted_date},
            'email': {'S': email},
            'rejectionType': {'S': state},
            'description': {'S': description}
        })

        #Data para insertar en los datos de envios
        data_to_insert_send_detail.append({
            'sendDetailId': {'S': id},
            'processDetailId': {'S': id},
            'uniqueId': {'S': unique_id},
            'email': {'S': email},
            'data': {'S': register},
            'date': {'S': formatted_date}
        })

        #Data para insertar en los estados
        data_to_insert_send_status.append({
            'sendStatusId': {'S': id},
            'sendDetailId': {'S': id},
            'date': {'S': formatted_date},
            'state': {'N': 11},
            'type1': {'S': description},
            'type2': {'S': description}
        })

    table_name_blacklist = f'{customer_name}_blacklist'
    table_blacklist = dynamodb.Table(table_name_blacklist)

    # Realiza la inserción en lotes utilizando el método batch_write_item
    with table_blacklist.batch_write_item(RequestItems={table_name_blacklist: [{'PutRequest': {'Item': item}} for item in data_to_insert_blacklist]}) as response:
        pass  # La inserción se realiza en el bloque 'with'
    # Verifica si hubo errores en la inserción
    if response.get('UnprocessedItems'):
        print('Hubo elementos no procesados:', response['UnprocessedItems'])
    else:
        print('Todos los elementos se insertaron correctamente.')

    table_name_details = f'{customer_name}_sendDetail_{process_id}'
    table_details = dynamodb.Table(table_name_details)

    # Realiza la inserción en lotes utilizando el método batch_write_item
    with table_details.batch_write_item(RequestItems={table_name_details: [{'PutRequest': {'Item': item}} for item in data_to_insert_send_detail]}) as response:
        pass  # La inserción se realiza en el bloque 'with'
    # Verifica si hubo errores en la inserción
    if response.get('UnprocessedItems'):
        print('Hubo elementos no procesados:', response['UnprocessedItems'])
    else:
        print('Todos los elementos se insertaron correctamente.')

    table_name_status= f'{customer_name}_sendStatus_{process_id}'
    table_status = dynamodb.Table(table_name_status)

    # Realiza la inserción en lotes utilizando el método batch_write_item
    with table_status.batch_write_item(RequestItems={table_name_status: [{'PutRequest': {'Item': item}} for item in data_to_insert_send_status]}) as response:
        pass  # La inserción se realiza en el bloque 'with'
    # Verifica si hubo errores en la inserción
    if response.get('UnprocessedItems'):
        print('Hubo elementos no procesados:', response['UnprocessedItems'])
    else:
        print('Todos los elementos se insertaron correctamente.')

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

def lambda_handler(event, context):
    """
    Función principal

    Args:
        event (dict): Datos de evento
        context (dict): Datos de contexto
        
    Returns:
        None: Personalizado
    """
    global process_id
    global campaign_id
    global customer_id
    global customer_name
    global formatted_date
    global from_email
    global headers
    global template_name
    global attachment

    status = True
    description = "Campaña enviandose correctamente"
    status_code = 200

    # Obtener la fecha y hora actual
    now = datetime.utcnow()
    # Formatear la fecha y hora según un formato específico
    formatted_date = now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + 'Z'

    try:
        # Obtener datos del evento        
        endpoint = event["resource"]
        print("endpoint: " + endpoint)
        data = json.loads(event["body"])
        #print(body)
        #data = json.loads(body)
        #print(data)
        customer_name = data["customerName"]
        print("Customer: " + customer_name)
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
                process_id = str(uuid.uuid4())
                # Detalles del archivo en S3
                bucket_name = f'{customer_name.lower()}.database'
                temp_file = f'/tmp/{customer_name}_{formatted_date}.tmp'  # Ruta temporal para almacenar el archivo descargado
                print("Process id:" + process_id)
                
                campaign_id = response_campaign['Items'][0]["campaignId"]   
                print("Despues de capturar el id de campaña")             
                #REVISAR
                #El siguiente campo parece que no lo necesito
                customer_id = response_campaign['Items'][0]["customerId"]
                consecutive = response_campaign['Items'][0]["consecutive"]
                channel_name = response_campaign['Items'][0]["channel"]
                data_path = response_campaign['Items'][0]["dataPath"]
                from_email = response_campaign['Items'][0]["originEmail"]
                
                # Define los detalles de la tabla processDetail
                table = f'{customer_name}_processDetail'
                id = 'processDetailId'
                was_created_table = check_and_create_table(table,id)

                if was_created_table:
                    #Tabla de unsubscribe
                    table = f'{customer_name}_unsubscribe'
                    id = 'unsubscribeId'
                    was_created_table = check_and_create_table(table,id)
                if was_created_table:
                    #Tabla de blacklist
                    table = f'{customer_name}_blackList'
                    id = 'blackListId'
                    was_created_table = check_and_create_table(table,id)


                #Estas tablas siempre se deben crear
                # Define los detalles de la tabla sendDetail
                table = f'{customer_name}_sendDetail_{process_id}'
                id = 'sendDetailId'
                was_created_table = check_and_create_table(table,id)

                # Define los detalles de la tabla sendDetail
                table = f'{customer_name}_sendStatus_{process_id}'
                id = 'sendStatusId'
                was_created_table = check_and_create_table(table,id)
                #Realizar la creacion de la cola para el cliente
                #Configurar la cola como disparador
                
                template_name = f'{customer_name}_{consecutive}_{channel_name}_{campaign_name}'

                #template_name = f'{customer_name}_{consecutive}_{channel_name}_PromocionesJunio'

                print(f"Channel: {channel_name}")
                #EAU = Email con adjunto unico (El mismo adjunto se envia a todos los destinatarios)
                #EAP = Email con adjunto personalizado (Se realiza personalizacion en campos para enviar a cada destinatario un adjunto diferente)
                #attachment = (channel_name == "EAU" or channel_name == "EAP")
                if channel_name == "EAU":
                    attachment = True
                    url_sqs= URL_SQS_EAU
                elif channel_name == "EAP":
                    attachment = True
                    url_sqs = URL_SQS_EAP
                else:
                    attachment = False
                    url_sqs = URL_SQS_EM
                registers = ""
                count_register = 0
                count_message = 0
                print("Queue: " + url_sqs)

                try:
                    # Descarga el archivo CSV desde S3
                    s3.download_file(bucket_name, data_path, temp_file)
                except:
                    update_campaign_status("Error")
                    description = f'No se pudo realizar la descarga del archivo "{temp_file}" del bucket "{bucket_name} - {data_path}"'                    
                    status = False
                    print(description)
                    status_code = 404
                else: 
                    registers = []
                    headers = ""
                    #En el front se debe agregar un boton o slider para elegir la cantidad de muestras
                    #Entre 1 y 5 muestras maximo
                    #Se debe poner entre 1 y 2 campos (1 campo para el email y el otro campo es para la identificacion que solo aplica si son muestras selectivas)                    
                    patron_email = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z0-9]{2,}$'

                    if samples:
                        print("Inica proceso de envio de muestras")                        
                        process = campaign_name + "-Samples"                    
                        quantity_samples = data['quantitySamples']   
                        print("Cantidad  muestras en el payload: " + str(quantity_samples))
                        selective_samples = data.get('selectiveSamples',False)                   
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
                                
                        if invalid_mail:
                            description = f'Error en las direcciones email enviadas para las muestras, emails con error: {invalid_mails}'                            
                            status = False
                            print(description)
                            status_code = 400
                        else:
                            print("Todos los email enviados son validos")
                            if selective_samples:
                                print("Proceso con muestras selectivas")
                                #En el proceso de muestras selectivas solo se van a enviar la cantidad de registros que se encuentren en el spool del cliente
                                #No se realizara el proceso de completar la cantidad de muestras

                                try:
                                    sample_identifications = data["identifications"]
                                    sample_identifications = set(sample_identifications)
                                    index_recipient = 0
                                    samples_count = 0                                
                                    print(f"Identificaciones para las muestras: {samples}")  

                                    #Opcion 2
                                    print('Inicio lectura del archivo para filtrar los registros de muestras selectivas y reemplazar el email real con el de muestras')
                                    with open(temp_file, 'r', encoding=ENCODING) as file:
                                        print("Apertura correcta del archivo Csv")
                                        # Leer y validar que el delimitador sea el correcto co
                                        reader = csv.reader(file, delimiter=DELIMITER)
                                        print("Lectura correcta del archivo como Csv")
                                        headers = next(reader) #Agrego la primer linea que pertenece al encabezado a una variable
                                        print("Headers: " + str(headers))
                                        for line in reader:
                                        #for line in file:  
                                            #print("Registro a procesar: " + str(line)) 
                                            #Reviso si ya asigne la cantidad total de muestras para no seguir recorriendo las lineas
                                            if samples_count == quantity_samples:
                                                print("Salgo del bucle porque ya encontre todas las muestras solicitadas")
                                                break
                                            id = int(line[0])
                                            #print(id)
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
                                                    #line = line.replace(real_email,new_email)
                                                    registers.append(line)
                                                    index_recipient += 1
                                                    break
                                    
                                    registers_to_send = samples_count

                                    #registers = search_samples(temp_file,identifications,recipients,quantitySamples,quantity_recipients)

                                    #registers = emailReplace(registers,recipients)
                                except Exception as e:
                                    print(e)
                                    update_campaign_status("Error")
                                    description = 'Error en el filtrado de los registros desde la base de datos original'                                    
                                    status = False
                                    print(description)
                                    status_code = 400
                                else:
                                    print('Los filtros de registros se realizaron de manera correcta')
                                    samples_found = len(registers)
                                    if samples_found > 0:
                                        print("Se procede a realizar los envios a la cola")
                                        messages = prepare_message(registers,1)
                                        send_sqs(url_sqs,messages)
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
                                        reader = csv.reader(file, delimiter=DELIMITER)
                                        print("Lectura correcta del archivo como Csv")
                                        headers = next(reader) #Agrego la primer linea que pertenece al encabezado a una variable
                                        print("Headers: " + str(headers))
                                        for line in reader:
                                        #for line in file:                                    
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
                                            #line = line.replace(real_email,new_email)
                                            registers.append(line)
                                            count_register += 1
                                            index_recipient += 1
                                            if count_register == quantity_samples:
                                                print("Preparar mensaje para enviar")
                                                messages = prepare_message(registers,1)
                                                send_sqs(url_sqs,messages)
                                                registers = []
                                                break
                                    #Valido si hay registros, es decir que la BD original no contenia los suficientes registros para las muestras
                                    if registers:
                                        print("La cantidad de muestras solicitada es mayor a la data que se encuentra en la BD")
                                        messages = prepare_message(registers,1)
                                        send_sqs(url_sqs,messages)

                                    # Elimina el archivo temporal descargado
                                    os.remove(temp_file)
                                    print("Se elimino el archivo temporal")
                                    registers_to_send = len(registers)
                                    print("Se asigno nuevamente la cantidad de registros a enviar")
                                except:
                                    update_campaign_status("Error")
                                    description = 'Error en el proceso de muestras automaticas'                                    
                                    status = False
                                    print(description)
                                    status_code = 400
                            insert_process(process,user_id,registers_to_send,registers_to_send,quantity_blacklist,quantity_unsubscribe,quantity_deletions,1,template_version,"Muestras")
                            print("Finaliza insercion en la tabla de procesos")
                            update_campaign_status("Muestras")
                            print("Finaliza actualizacion de la tabla de estado de la campaña")
                    else:
                        print("Inicia proceso de envio real")
                        update_campaign_status("Enviando")
                        
                        if (channel_name == "EM"): 
                            registers_for_message = REGISTERS_FOR_EM         
                        if (channel_name == "EAU"): 
                            registers_for_message = REGISTERS_FOR_EAU
                        if (channel_name == "EAP"): 
                            registers_for_message = REGISTERS_FOR_EAP
                        global_counter_message = 0 

                        keys = []       
                        emails_error = []
                        registers_unsubscribe = []
                        registers_blacklist = []
                        destinations = []
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
                                reader = csv.reader(file, delimiter=DELIMITER)
                                headers = next(reader) #Agrego la primer linea que pertenece al encabezado a una variable
                                print("Headers: " + str(headers))
                                for line in reader:
                                #for line in file:
                                    registers_on_spool += 1
                                    #En este primer for recorro los registros y verifico si no tienen error de estructura
                                    #Los registros sin error los guardo para luego verificar en las listas negras y unsubscribe
                                    #Los registros buenos los agrego a un array y los malos a otro
                                    #for data in arrayData:
                                    email = line[1]
                                    #print(email)
                                    if re.match(patron_email, email):
                                        #Voy agregando los email a una lista para posteriormente verificar si estan en lista negra o desinscritos
                                        #emailList.append(email)
                                        keys.append({'email': email})
                                        registers_correct.append(line)
                                    else:
                                        emails_error.append(line)
                            print("Finaliza lectura del archivo spool para validar registros con estructura de email incorrecta")
                            #consultar registros en unsubscribe y blacklist
                            #Solo consulto si la tabla de unsubscribe o blacklist ya existia, ya que si es el primer proceso no debe existir ningun registro en las tablas
                            blacklist_emails = []
                            unsubscribes_emails = []
                            if not was_created_table:
                                unsubscribes_emails = check_unsubscribes(keys)
                                quantity_unsubscribe = len(unsubscribes_emails)

                                blacklist_emails = check_blacklist(keys)
                                quantity_blacklist = len(blacklist_emails)

                            print("Cantidad registros en blacklist: " + str(quantity_blacklist))                            
                            print("Cantidad registros en unsubscribe: " + str(quantity_unsubscribe))

                            quantity_deletions = len(emails_error)
                            print("Cantidad registros con estructura incorrecta: " + str(quantity_deletions))

                            print("Inicio de clasificacion email correctos para el envio")

                            for line in registers_correct:
                                email = line[1]
                                if email in blacklist_emails:
                                    print(f"El correo electrónico {email} está en la lista negra")
                                    registers_blacklist.append(line)
                                elif  email in unsubscribes_emails:
                                    print(f"El correo electrónico {email} se ha dado de baja.")
                                    registers_unsubscribe.append(line)
                                else:       
                                    count_register += 1
                                    registers.append(line)
                                    if count_register == registers_for_message:
                                        global_counter_message += 1
                                        count_register = 0
                                        message = prepare_message(registers,global_counter_message)
                                        #Enviar a SQS
                                        send_sqs(url_sqs,message)
                                        #borrar messages
                                        registers = []
                                        
                            #Si aun existen registros (porque no se completo el lote de X) se envian en un mensaje a SQS
                            if registers:
                                global_counter_message += 1
                                message = prepare_message(registers,global_counter_message)
                                #Enviar a SQS
                                #upload_s3
                                send_sqs(url_sqs,message)

                            registers_to_send = len(registers_correct)
                        except Exception as e:
                            update_campaign_status("Error")
                            print(e)
                            print('Error en el proceso de envios reales')
                            status = False
                            description = 'Error en el proceso de envios reales'
                            status_code = 400
                        else:
                            print("TotalMensajes: " + str(global_counter_message)) 
                            #El total de mensajes es el total de partes para insertar en processDetail    
                            insert_process(campaign_name,user_id,registers_on_spool,registers_to_send,quantity_blacklist,quantity_unsubscribe,quantity_deletions,global_counter_message,template_version,"Procesando")
                            #Elimina el archivo temporal descargado
                            os.remove(temp_file)

                            print("Proceso de registro de errores en la tabla de processDetail")
                            #Insertar los email desinscritos en las tablas de estados y de datos
                            insert_mails_status(emails_error,11,"El email no tiene una estructura valida")
                            #Insertar los email desinscritos en las tablas de estados y de datos
                            insert_mails_status(registers_unsubscribe,12,"El email se encuentra desinscrito para este cliente")
                            #Insertar los email que estaban en la lista negra en las tablas de estados y de datos
                            insert_mails_status(registers_blacklist,13,"El email se encuentra en la lista negra de este cliente")
                            

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
            update_campaign_status("Error")
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
