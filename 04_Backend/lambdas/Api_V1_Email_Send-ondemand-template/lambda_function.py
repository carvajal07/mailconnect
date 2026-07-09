'''
Lambda para realizar los envios de notificaciones internas de mailconnect
'''
import re
import uuid
import json
from datetime import datetime

import boto3

REGION = 'us-east-1'

global formatted_date
global process_detail_id

# Crea un cliente SES
ses = boto3.client('ses',region_name=REGION)


# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')
# Crear un cliente de DynamoDB
table_process_detail = dynamodb.Table('mailconnect_processDetail')
table_send_detail = dynamodb.Table('mailconnect_sendDetail_default')
table_unsubscribe = dynamodb.Table('mailconnect_unsubscribe')
table_blacklist = dynamodb.Table('mailconnect_blacklist')

def insert_process_detail(sender:str,email:str,template:str,template_version:int,state:str,error_description:str)->None:
    """
    Esta función realiza el insert del registro a la tabla de detalles del proceso.

    Args:
        sender (str): Cuenta de email desde donde se realiza el envio
        email (str): Email del cliente
        template (str): Nombre del template configurado en SES
        template_version (int): Version del template que se desea enviar
        state (str): Estado del envio
        error_description (str): Descripcion detallada del error
        
    Returns:
        None: No retorna resultados
    """
    # Insertar datos en la tabla de campañas
    table_process_detail.put_item(
        Item={
            'processDetailId': process_detail_id,
            'sender': sender,
            'recipient': email,
            'template': template,
            'templateVersion': template_version,
            'dateSend': formatted_date,
            'state': state,
            'errorDescription': error_description
        }
    )

def insert_send_detail(send_detail_id:str,email:str,data:dict)->None:
    """
    Función encargada de insertar los detalles de cada envio a la base de datos.

    Args:
        send_detail_id (str): Identificador unico del envio
        email (str): Email del cliente
        data (dict): Diccionario con las información de personalizacion del envio
        
    Returns:
        None: No retorna resultados
    """
    table_send_detail.put_item(
        Item={
            'sendDetailId': send_detail_id,
            'processDetailId': process_detail_id,
            'uniqueId': "",
            'email': email,
            'data': data,
            'date': formatted_date
        }
    )

def insert_blacklist(email:str,rejection_type:str,description:str)->None:
    """
    Esta función realiza el insert de los registros a la tabla de lista negra.

    Args:
        email (str): Email del cliente
        rejection_type (str): Tipo de rechazo
        description (str): Descripcion del rechazo

    Returns:
        None
    """
    blacklist_id = str(uuid.uuid4())

    # Insertar datos en la tabla de lista negra
    table_blacklist.put_item(
        Item={
            'blacklistId': blacklist_id,
            'date': formatted_date,
            'email': email,
            'rejectionType': rejection_type,
            'description': description
        }
    )

def check_unsubscribe(email:str)->bool:
    """
    Esta función se encarga de consultar el email en la lista de desinscritos de mailconnect

    Args:
        email (str): Direccion de email a consultar

    Returns:
        bool: Retorna true si el email esta desinscrito
    """
    projection_unsubscribe_expression = 'unsubscribeId'  # Lista de campos a consultar

    response_unsubscribe = table_unsubscribe.scan(
        FilterExpression="email = :value",
        ExpressionAttributeValues={":value": email},
        ProjectionExpression=projection_unsubscribe_expression
    )
    return len(response_unsubscribe['Items']) != 0

def check_blacklist(email:str)->bool:
    """
    Esta función se encarga de consultar el email en la lista negra de mailconnect

    Args:
        email (str): Direccion de email a consultar

    Returns:
        bool: Retorna true si el email esta en la lista negra
    """
    projection_blacklist_expression = 'blacklistId'  # Lista de campos a consultar

    response_blacklist = table_blacklist.scan(
        FilterExpression="email = :value",
        ExpressionAttributeValues={":value": email},
        ProjectionExpression=projection_blacklist_expression
    )
    return len(response_blacklist['Items']) != 0

def lambda_handler(event, context):
    """
    Función principal

    Args:
        event (dict): Datos de evento
        context (dict): Datos de contexto
        
    Returns:
        None: Personalizado
    """
    global formatted_date
    global process_detail_id
    status = True
    state = "Enviado"
    description = "Envio realizado correctamente"
    status_code = 200
    print(event)

    # Obtener datos del evento
    sender = event['sender']
    recipient = event['recipient']
    template = event['template']
    data = json.dumps(event['data']) #Se espera que llegue un diccionario con los nombres acorde a lo que esta en el template
    template_version = event['templateVersion']

    print("data: " + data)


    process_detail_id = str(uuid.uuid4())
    # Obtener la fecha y hora actual

    now = datetime.now()
    # Formatear la fecha y hora según un formato específico
    formatted_date = now.strftime("%Y-%m-%d %H:%M:%S")

    '''
    # Obtiene la información de la plantilla
    templateResponse = ses.get_template(TemplateName=template)
    # La versión actual de la plantilla se encuentra en el campo `Version`
    templateVersion = templateResponse['Template']['Version']
    '''
    patron_email = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z0-9]{2,}$'
    if not re.match(patron_email, recipient):
        insert_blacklist(recipient,"EmailInvalido","La estructura del email no es correcta")
        status = False
        state = "Error"
        status_code = 400
        description = f"El email {recipient} no tiene una estructura correcta"
        print(description)
    else:
        if check_unsubscribe(recipient):
            status = False
            state = "Error"
            status_code = 400
            description = f"El email {recipient} se encuentra desinscrito"
            print(description)
        elif check_blacklist(recipient):
            status = False
            state = "Error"
            status_code = 400
            description = f"El email {recipient} se encuentra en la lista negra"
            print(description)
        else:
            tags = [{
                "Name":"customer",
                "Value":"mailconnect"
            },
            {
                "Name":"campaingId",
                "Value":"generic"
            },
            {
                "Name":"processId",
                "Value":"default"
            }]
            try:
                # Envía el correo electrónico
                response = ses.send_templated_email(
                    ConfigurationSetName='default',
                    Source=sender,
                    Destination={'ToAddresses': [recipient]},
                    Template=template,
                    TemplateData=data,
                    Tags=tags
                )
                send_detail_id = response.get('MessageId', str(uuid.uuid4())+"-Error")
                insert_send_detail(send_detail_id,recipient,data)
                print("Correo electrónico enviado correctamente")
            except ses.exceptions.ClientError as e:
                # Maneja diferentes tipos de errores
                state = "Error"
                if e.response['Error']['Code'] == 'TemplateDoesNotExist':
                    error_description = f"Error: La plantilla '{template}' no existe."
                elif e.response['Error']['Code'] == 'SenderNotFound':
                    error_description = f"Error: El remitente '{sender}' no se encuentra."
                else:
                    error_description = f"Error: {e.response['Error']['Message']}"
                print(e.response['Error'])
                print(error_description)
                description = error_description

    insert_process_detail(sender,recipient,template,template_version,state,description)
    # Respuesta
    response = {
        'status':status,
        'statusCode': status_code,
        'description':description,
    }

    return response
