'''
Lambda para realizar la recepcion de todos los estados de emails enviados
'''
import os
import json
import uuid
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

global customer_name
global process_id
global message_id
global timestamp
global state

#pylint: disable=C0301
REGION = 'us-east-1'
#Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb', region_name=REGION)

# ───────────────────────── Pre-agregación de contadores (opcional) ─────────────────────────
# Mantiene un RESUMEN por proceso ({customer}_sendSummary, PK processId) con el embudo ya
# contado, para que los reportes lean O(1) en vez de escanear millones de filas. Es
# transición-consciente: un mensaje que avanza de estado se mueve de bucket (suma el
# ganado, resta el perdido) usando su estado actual en {customer}_sendState (PK processId
# + SK messageId), actualizado con condición atómica (solo avanza en prioridad).
#
# Se mantiene SIEMPRE (por defecto, sin env): cada evento actualiza el resumen para que
# los reportes lean O(1). Es best-effort: si las tablas `{customer}_sendSummary`/`_sendState`
# no existen o algo falla, NO rompe la recepción (los reportes caen al scan por proceso).
_SUMMARY_PRIORITY = {1: 1, 9: 2, 8: 3, 3: 4, 2: 5, 6: 6, 10: 7, 7: 8, 4: 9, 5: 10}


def _summary_milestones(state_num):
    '''Buckets del embudo que implica un estado (mismo criterio que los reportes).'''
    if not state_num:
        return set()
    s = int(state_num)
    ms = {'enviados'}
    if s in (2, 4, 5, 7):
        ms.add('entregados')
    if s in (4, 5):
        ms.add('abiertos')
    if s == 5:
        ms.add('clics')
    if s in (3, 6):
        ms.add('rebotes')
    if s == 7:
        ms.add('quejas')
    return ms


def bump_send_summary(customer_name, process_id, message_id, state):
    '''Actualiza el resumen agregado del proceso ante un nuevo estado de un mensaje.
    Idempotente y transición-consciente; best-effort (nunca lanza).'''
    if not (customer_name and process_id and message_id):
        return
    try:
        new_state = int(state)
    except (TypeError, ValueError):
        return
    if new_state <= 0:
        return
    new_prio = _SUMMARY_PRIORITY.get(new_state, 0)
    try:
        # Avanza el estado del mensaje SOLO si el nuevo tiene mayor prioridad (atómico).
        resp = dynamodb.Table('{}_sendState'.format(customer_name)).update_item(
            Key={'processId': process_id, 'messageId': message_id},
            UpdateExpression='SET #s = :s, #p = :p',
            ConditionExpression='attribute_not_exists(#p) OR #p < :p',
            ExpressionAttributeNames={'#s': 'state', '#p': 'prio'},
            ExpressionAttributeValues={':s': new_state, ':p': new_prio},
            ReturnValues='ALL_OLD')
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return  # el mensaje ya estaba en un estado igual o mayor: nada que sumar
        print('sendSummary(state): {}'.format(e))
        return
    except Exception as e:
        print('sendSummary(state): {}'.format(e))
        return
    old_state = (resp.get('Attributes') or {}).get('state')
    gained = _summary_milestones(new_state) - _summary_milestones(old_state)
    lost = _summary_milestones(old_state) - _summary_milestones(new_state)
    if not gained and not lost:
        return
    parts, names, vals = [], {}, {}
    for i, m in enumerate(list(gained) + list(lost)):
        parts.append('#m{0} :v{0}'.format(i))
        names['#m{0}'.format(i)] = m
        vals[':v{0}'.format(i)] = 1 if m in gained else -1
    try:
        dynamodb.Table('{}_sendSummary'.format(customer_name)).update_item(
            Key={'processId': process_id},
            UpdateExpression='ADD ' + ', '.join(parts),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=vals)
    except Exception as e:
        print('sendSummary(counters): {}'.format(e))

#states
#1	Enviado
#2	Entregado
#3	Rechazado
#4	Abierto
#5	Clicado
#6	Rebote
#7	Queja
#8	FallaRenderizado
#9	Retrazado
#10	Suscrito

#Mapeo de estados de SES
state_ses_mapping = { 
    'Send': 1,
    'Delivery': 2,
    'Reject': 3,
    'Open': 4,
    'Click': 5,
    'Bounce': 6,
    'Complaint': 7,
    'Rendering Failure': 8,
    'DeliveryDelay': 9,
    'Subscription': 10
}

########################

#NO DEBO ACEPTAR NOMBRES DE CLIENTES DE MAS DE 50 CARACTERES

########################

#bounce:
#- timestamp
#- bounceType - bounceSubType
#  Undetermined - Undetermined: Amazon SES no ha podido determinar un motivo específico de rebote.
#  Permanent - General: Amazon SES recibió un rechazo permanente general. Si recibe este tipo de rebote, debería eliminar la dirección de correo electrónico del destinatario de su lista de correo.
#  Permanent - NoEmail: Amazon SES recibió un rechazo permanente porque la dirección de correo electrónico de destino no existe. Si recibe este tipo de rebote, debería eliminar la dirección de correo electrónico del destinatario de su lista de correo.
#  Permanent - Suppressed: Amazon SES ha suprimido el envío a esta dirección dado que tiene un historial reciente de rebotes como dirección no válida. Para anular la lista de supresión global, consulte Uso de la lista de supresión de nivel de cuenta de Amazon SES.
#  Permanent - OnAccountSuppressionList: Amazon SES ha suprimido el envío a esta dirección porque está en la lista de supresión de nivel de cuenta. Esto no se toma en cuenta para calcular la métrica de porcentaje de rebotes.
#  Transient - General: Amazon SES recibió un rebote general. Es posible que pueda enviar correctamente a este destinatario en el futuro.
#  Transient - MailboxFull: Amazon SES ha recibido un rebote completo de bandeja de entrada. Es posible que pueda enviar correctamente a este destinatario en el futuro.
#  Transient - MessageTooLarge: Amazon SES recibió un rebote de mensaje demasiado grande. Es posible que pueda enviar correctamente a este destinatario si reduce el tamaño del mensaje.
#  Transient - ContentRejected: Amazon SES ha recibido un rebote de contenido rechazado. Es posible que pueda enviar correctamente a este destinatario si cambia el contenido del mensaje.
#  Transient - AttachmentRejected: Amazon SES ha recibido un rebote de archivo adjunto rechazado. Es posible que pueda enviar correctamente a este destinatario si elimina o cambia el archivo adjunto.

#complaint
#- timestamp
#- complaintFeedbackType
#  abuse: Indica correo electrónico no solicitado o algún otro tipo de abuso de correo electrónico.
#  auth-failure: Informe de error de autenticación de correo electrónico.
#  fraud: Indica algún tipo de fraude o actividad de phishing.
#  not-span: Indica que la entidad que proporciona el informe no considera el mensaje como spam. Esto se puede utilizar para corregir un mensaje que estaba mal etiquetado o clasificado como spam.
#  other: Indica cualquier otra retroalimentación que no encaje en otros tipos registrados.
#  virus: Notifica que se ha encontrado un virus en el mensaje de origen.

#deliveryDelay
#- timestamp
#- delayType
#  InternalFailure: un problema interno de Amazon SES provocó que el mensaje se retrasara.
#  General: se produjo un error genérico durante la conversación SMTP.
#  MailboxFull: el buzón del destinatario está lleno y no puede recibir mensajes adicionales.
#  SpamDetected: el servidor de correo del destinatario detectó una gran cantidad de correos electrónicos no solicitados de su cuenta.
#  RecipientServerError: un problema temporal con el servidor de correo electrónico del destinatario impide la entrega del mensaje.
#  IPFailure: el proveedor de correo electrónico del destinatario bloquea o limita la dirección IP que envía el mensaje.
#  TransientCommunicationFailure: hubo un error temporal de comunicación durante la conversación SMTP con el proveedor de correo electrónico del destinatario.
#  BYOIPHostNameLookupUnavailable: Amazon SES no pudo buscar el nombre de anfitrión DNS para sus direcciones IP. Este tipo de retraso únicamente se produce cuando se utiliza Bring Your Own IP.
#  Undetermined: Amazon SES no pudo determinar el motivo del retraso en la entrega.
#  SendingDeferral: Amazon SES ha considerado apropiado aplazar de forma interna el mensaje.

#delivery
#- timestamp

#suscription
#- timestamp

#click
#- timestamp
#- ipAddress
#- link
#- linkTags

#open
#- timestamp
#- ipAddress

#reject
#- reason: La razón por la que se rechazó el correo electrónico. El único valor posible es Bad content, lo que significa que Amazon SES detectó que el correo electrónico contenía un virus. Cuando se rechaza un mensaje, Amazon SES detiene el procesamiento y no intenta entregarlo al servidor de correo del destinatario.

#failure (Error en el renderizado de plantillas SES)
#- errorMessage


def insert_blacklist(customer_name:str,email:str,rejection_type:str,description:str)->None:
    """
    Esta función realiza el insert de los registros a la tabla de lista negra.

    Args:
        customer_name (str): Nombre del cliente
        date (str): Fecha de insercion
        email (str): Email del cliente
        rejection_type (str): Tipo de rechazo
        description (str): Descripcion del rechazo

    Returns:
        None
    """
    # Obtener la fecha y hora actual
    now = datetime.utcnow()
    # Formatear la fecha y hora según un formato específico
    formatted_date = now.strftime("%Y-%m-%d %H:%M:%S")
    blacklist_id = str(uuid.uuid4())
    table_blacklist = dynamodb.Table(f'{customer_name}_blackList')

    # Insertar datos en la tabla de lista negra
    table_blacklist.put_item(
        Item={
            'blackListId': blacklist_id,
            'date': formatted_date,
            'email': email,
            'rejectionType': rejection_type,
            'description': description
        }
    )

def insert_status(type1:str,type2:str)->None:
    """
    Esta función obtiene los datos de la campaña.

    Args:
        campaignName (str): Nombre de la campana

    Returns:
        dict: Nombre de la campaña
    """
    send_status_id = str(uuid.uuid4())
    # Tabla ÚNICA {customer}_sendStatus (PK processId + SK sendStatusId); antes era una
    # tabla por proceso ({customer}_sendStatus_{proceso}).
    table_send_status = dynamodb.Table(f'{customer_name}_sendStatus')

    table_send_status.put_item(
        Item={
            'processId': process_id,
            'sendStatusId': send_status_id,
            'messageId': message_id,
            'date': timestamp,
            'state': state,
            'type1': type1,
            'type2': type2
        }
    )
    # Pre-agregación: mantiene el resumen por proceso (best-effort, gated).
    bump_send_summary(customer_name, process_id, message_id, state)

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
    global process_id
    global message_id
    global timestamp
    global state    

    #Obtener el mensaje SNS
    body = event["Records"][0]["body"]
    json_body = json.loads(body)
    print(json_body)
    #message_sqs = event['Records'][0]["body"]['Message']
    message = json.loads(json_body['Message'])

    #Extraer el estado de SES y el messageId
    event_type = message['eventType']
    message_mail = message['mail']
    message_id = message_mail['messageId']
    print("MessageId: " + message_id)
    print("Event: " + event_type)
    #Captura de tags
    tags = message_mail['tags']
    customer_name = tags['customer'][0]    
    campaing_id = tags['campaingId'][0]
    process_id = tags['processId'][0]

    # Mapear el estado de SES a un nombre legible
    state = state_ses_mapping.get(event_type,0) #Estado desconocido
    timestamp = message_mail['timestamp']
    print("Customer: " + customer_name)
    ###################
    #Mas probables
    #Send
    if state == 1:
        insert_status("","")
    #Delivery
    elif state == 2:
        timestamp = message['delivery']['timestamp']
        insert_status("","")
    #Open
    elif state == 4:
        timestamp = message['open']['timestamp']
        ip_address = message['open']['ipAddress']
        insert_status(ip_address,"")
    #Click
    elif state == 5:
        timestamp = message['click']['timestamp']
        ip_address = message['click']['ipAddress']
        link = message['click']['link']
        insert_status(ip_address,link)

    ###################
    #Probables
    #Reject
    elif state == 3:
        reason = message['reject']['reason']
        insert_status(reason,"")
    #Bounce
    elif state == 6:
        timestamp = message['bounce']['timestamp']
        bounce_type = message['bounce']['bounceType']
        bounce_subtype = message['bounce']['bounceSubType']
        if bounce_type == "Permanent":
            #Enviar a la lista negra
            email = message['bounce']['bouncedRecipients'][0]['emailAddress']
            insert_blacklist(customer_name,email,bounce_type,bounce_subtype)
        #Insertar estado
        insert_status(bounce_type,bounce_subtype)

    ###################
    #Menos probables
    #Complaint
    elif state == 7:
        timestamp = message['complaint']['timestamp']
        complaint_feedback_type = message['complaint']['complaintFeedbackType']
        insert_status(complaint_feedback_type,"")
    #Rendering Failure
    elif state == 8:
        error_message = message['failure']['errorMessage']
        insert_status(error_message,"")
    #DeliveryDelay
    elif state == 9:
        timestamp = message['deliveryDelay']['timestamp']
        delay_type = message['deliveryDelay']['delayType']
        insert_status(delay_type,"")
    #Subscription
    elif state == 10:
        timestamp = message['subscription']['timestamp']
        insert_status("","")
    else:
        pass
