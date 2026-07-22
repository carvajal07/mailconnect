import os
import re
import uuid
import boto3
from datetime import datetime, timedelta
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError


# Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')

# Inicializar el cliente SES
ses_client = boto3.client('ses', region_name='us-east-2')

table_customer = dynamodb.Table('customer')
tabla_consecutive = dynamodb.Table('campaignControl')
# Contador ATÓMICO por cliente para el consecutivo (PK customerId). Garantiza que dos
# creaciones concurrentes NO obtengan el mismo número (ver next_consecutive).
table_counter = dynamodb.Table('campaignCounter')
table_campaign = dynamodb.Table('campaign')
table_channel = dynamodb.Table('channel')
table_document = dynamodb.Table('document')
_audit_table = dynamodb.Table('adminAudit')
table_domain = dynamodb.Table('senderDomain')

# Dominio de la plataforma (remitente por defecto, siempre permitido).
PLATFORM_DOMAIN = os.environ.get('PLATFORM_DOMAIN', 'mailconnect.com.co')


def _from_allowed(customer_id, from_address):
    """¿El remitente está permitido para el cliente? True si:
       - el dominio del remitente es el de la plataforma, o
       - hay un DOMINIO verificado del cliente que coincide con el dominio del remitente, o
       - hay un CORREO verificado del cliente que coincide EXACTO con la dirección completa.
    (SES permite ambos tipos de identidad de remitente.) Fail-open: si la tabla no existe o
    falla el lookup, devuelve True (no bloquea el rollout)."""
    from_address = str(from_address or '').strip().lower()
    from_domain = from_address.split('@')[-1]
    if from_domain == PLATFORM_DOMAIN or from_domain.endswith('.' + PLATFORM_DOMAIN):
        return True
    try:
        from boto3.dynamodb.conditions import Key
        resp = table_domain.query(
            IndexName='customerId-index',
            KeyConditionExpression=Key('customerId').eq(customer_id))
        for it in resp.get('Items', []):
            if it.get('status') != 'verified':
                continue
            value = str(it.get('domain', '')).lower()
            # kind autodetectado por '@' para filas legacy sin el campo.
            kind = it.get('kind') or ('email' if '@' in value else 'domain')
            if kind == 'email' and value == from_address:
                return True
            if kind == 'domain' and value == from_domain:
                return True
        return False
    except Exception as e:
        print('No se pudo validar el remitente (fail-open): {}'.format(e))
        return True


def _audit_event(event, action, target, detail):
    """Bitácora (adminAudit) best-effort. El actor sale del context del Authorizer."""
    try:
        auth = (event.get('requestContext') or {}).get('authorizer') or {} if isinstance(event, dict) else {}
        _audit_table.put_item(Item={
            'auditId': str(uuid.uuid4()),
            'action': action,
            'actor': str(auth.get('user') or auth.get('userId') or 'cliente'),
            'actorId': str(auth.get('userId') or ''),
            'customer': str(auth.get('customer') or ''),
            'target': str(target),
            'detail': str(detail),
            'date': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'),
        })
    except Exception as e:
        print('No se pudo registrar auditoría: {}'.format(e))


def select_customerName(customerId):
    # customerId es la PK de `customer` → GetItem O(1) (antes Scan+filter).
    item = table_customer.get_item(
        Key={'customerId': customerId}, ProjectionExpression='company').get('Item') or {}
    return item.get('company', '')
    
def select_channelName(channelId):
    projectionName_expression = 'channelName'  # Lista de campos a consultar

    response = table_channel.scan(
        FilterExpression="channelId = :value",
        ExpressionAttributeValues={":value": int(channelId)},
        ProjectionExpression=projectionName_expression
    )
    return response['Items'][0]['channelName']

def _find_control(customerId, projection):
    """Primer ítem de campaignControl del cliente. Pagina el Scan (LastEvaluatedKey)
    para no perder el ítem si la tabla supera 1 MB (antes, sin paginar, devolvía
    vacío → el consecutivo se reiniciaba a 0001 e insertaba un duplicado)."""
    kwargs = {
        'FilterExpression': 'customerId = :value',
        'ExpressionAttributeValues': {':value': customerId},
        'ProjectionExpression': projection,
    }
    while True:
        resp = tabla_consecutive.scan(**kwargs)
        if resp.get('Items'):
            return resp['Items'][0]
        last = resp.get('LastEvaluatedKey')
        if not last:
            return None
        kwargs['ExclusiveStartKey'] = last


def consult_consecutive(customerId):
    # NOTA: sigue habiendo carrera si dos creaciones concurren (mismo consecutivo);
    # el fix atómico (ADD sobre PK=customerId) requiere migrar la tabla (Fase 3).
    consecutive = "0000"
    item = _find_control(customerId, 'numeration')
    if item:
        consecutive = item['numeration']

    consecutiveInt = int(consecutive)
    consecutiveInt += 1
    consecutiveString = str(consecutiveInt)
    consecutive = consecutiveString.zfill(4)
    return consecutive

def update_consecutive(customerId,consecutive):
    item = _find_control(customerId, 'campaignControlId')
    if not item:
        # No existe el control del cliente: crear (primer consecutivo o tabla vacía).
        tabla_consecutive.put_item(
            Item={
                'campaignControlId': str(uuid.uuid4()),
                'customerId': customerId,
                'numeration': consecutive
            }
        )
    else:
        campaignControlId = item['campaignControlId']
        responseUpdateConsecutive = tabla_consecutive.update_item(
            Key={'campaignControlId':campaignControlId},
            UpdateExpression='SET numeration = :s',
            ExpressionAttributeValues={':s': consecutive},
            ReturnValues='UPDATED_NEW'
        )
        print(responseUpdateConsecutive['Attributes'])


def _legacy_next_consecutive(customerId):
    """Fallback SIN contador atómico (tabla campaignCounter no provisionada): el viejo
    lee-incrementa-escribe sobre campaignControl. Mantiene la carrera conocida, pero deja
    operar antes de crear campaignCounter (deploy flexible)."""
    consecutive = consult_consecutive(customerId)
    update_consecutive(customerId, consecutive)
    return consecutive


def _seed_counter_if_absent(customerId):
    """Siembra el contador del cliente, la PRIMERA vez, desde el valor legado de
    campaignControl, para NO colisionar con las campañas ya creadas. Condicional
    (attribute_not_exists): si el contador ya existe no lo toca; ante concurrencia solo un
    put gana y el resto ve ConditionalCheckFailed (comportamiento correcto)."""
    item = _find_control(customerId, 'numeration')
    legacy = 0
    if item:
        try:
            legacy = int(item.get('numeration', 0))
        except (TypeError, ValueError):
            legacy = 0
    try:
        table_counter.put_item(
            Item={'customerId': customerId, 'numeration': legacy},
            ConditionExpression='attribute_not_exists(customerId)')
    except ClientError as e:
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise  # el ResourceNotFound (tabla ausente) sube y lo maneja next_consecutive


def next_consecutive(customerId):
    """Siguiente consecutivo del cliente de forma ATÓMICA (sin carrera).

    Usa un contador por cliente (campaignCounter, PK customerId) con `ADD numeration :1`,
    operación que DynamoDB serializa a nivel de ítem: dos creaciones concurrentes obtienen
    números DISTINTOS → no hay consecutivos duplicados (unicidad garantizada). El número
    devuelto ya quedó PERSISTIDO (no hay que reescribirlo). Si la tabla del contador aún no
    existe, cae al método legado (con su carrera) para no romper la creación."""
    try:
        _seed_counter_if_absent(customerId)
        resp = table_counter.update_item(
            Key={'customerId': customerId},
            UpdateExpression='ADD numeration :one',
            ExpressionAttributeValues={':one': 1},
            ReturnValues='UPDATED_NEW')
        return str(int(resp['Attributes']['numeration'])).zfill(4)
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            print('campaignCounter no existe; se usa el consecutivo legado (con carrera).')
            return _legacy_next_consecutive(customerId)
        raise


def insert_campaign(customerId,campaignName,numeration,channel,dataPath,template,source,date,documentFormat=None,attachmentType=None):
    campaignId = str(uuid.uuid4())
    item = {
        'campaignId': campaignId,
        'customerId': customerId,
        'campaignName': campaignName,
        'consecutive': numeration,
        'channel': channel,
        'dataPath': dataPath,
        'template': template,
        'originEmail': source,
        'campaignState': 'Pendiente',
        # Contador de envíos de muestras (máx. MAX_SAMPLE_SENDS en Prepare-batch).
        'samplesSentCount': 0,
        # Flujo de aprobación (maker-checker): none → pending → approved/rejected.
        # Ver PLAN_APROBACIONES.md. El envío real exige approvalStatus == 'approved'.
        'approvalStatus': 'none',
        'date': date
    }
    # Solo EAP: formato del documento (DOCX = combinación Word, PDF = campos personalizados).
    # Se guarda en la campaña para que Prepare-batch pueda enrutar al armador correcto.
    if documentFormat:
        item['documentFormat'] = documentFormat
    # Modo de entrega del adjunto (NONE/ONFILE/ONLINE). Se guarda TAMBIÉN en la campaña
    # (además de en `document`) para que el débito y la facturación puedan tarifar por modo.
    item['attachmentType'] = attachmentType or 'NONE'
    # Insertar datos en la tabla de campañas
    table_campaign.put_item(Item=item)
    return campaignId

def create_template(customerName,channelName,consecutive,campaignName,subject,template):
    # El nombre SES NO lleva el canal (una plantilla aplica a varios canales de email).
    templateName = f'{customerName}_{consecutive}_{campaignName}'
    print("template:" + templateName)
    response = ses_client.create_template(
        Template={
            'TemplateName': templateName,
            'SubjectPart': subject,
            'HtmlPart': template,
            "TextPart": template
        }
    )

    print("plantilla creada correctamente")    

def insert_attachment(campaignId,attachment_type,documentPath,variableDocument,date,documentFormat=None):
    documentId = str(uuid.uuid4())
    item = {
        'documentId': documentId,
        'campaignId': campaignId,
        # Antes guardaba el literal "attachment_type" (bug): la lambda de envío EAU
        # leía siempre un valor incorrecto y el ONFILE/ONLINE no funcionaba.
        'attachmentType': attachment_type,
        'documentPath': documentPath,
        'variableDocument': variableDocument,
        'date': date
    }
    # Formato del documento EAP (DOCX/PDF): lo usa el armador del adjunto personalizado.
    if documentFormat:
        item['documentFormat'] = documentFormat
    # Insertar datos en la tabla de documentos
    table_document.put_item(Item=item)

def lambda_handler(event, context):

    # Compat mapping template no-proxy: si el payload llega como
    # {body:{...}, requestContext:{...}}, se aplana el body al nivel de event
    # (preservando requestContext para el context del Authorizer). Si ya viene
    # plano (passthrough legacy), no hace nada.
    if isinstance(event, dict) and isinstance(event.get("body"), dict):
        _rc = event.get("requestContext")
        event = dict(event["body"])
        if _rc:
            event["requestContext"] = _rc
    status = True
    description = "Campaña creada correctamente"
    statusCode = 201
    validData = True
    campaignId = ""
    
    # Obtener la fecha y hora actual
    now = datetime.utcnow()
    # Formatear la fecha y hora según un formato específico
    formattedDate = now.strftime("%Y-%m-%d %H:%M:%S")
    
    try:
        # customerId: preferir SIEMPRE la identidad del Authorizer sobre el body,
        # para que un cliente no cree campañas a nombre de otro tenant. Sin
        # contexto: si no llega, se deniega.
        _auth = (event.get('requestContext') or {}).get('authorizer') or {} if isinstance(event, dict) else {}
        customerId = _auth.get('customerId')
        if not customerId:
            return {'status': False, 'statusCode': 403,
                    'description': 'Sesión sin identidad de cliente.'}
        campaignName = event['campaignName']
        channelName = event['channelName']
        attachment_type = event['attachmentType']  
        dataPath = event['dataPath']   
        template = event['template']
        source = event['from']

        #Si el campo de from llega con @ quiere decir que este ya tiene su dominio, en caso contrario agregamos "mailconnect.com.co"
        if (not "@" in source):
            source += "@mailconnect.com.co"

        # Validación del remitente (solo email): debe ser el dominio de la plataforma, un
        # DOMINIO verificado del propio cliente, o un CORREO verificado del cliente (identidad
        # exacta). Evita spoofing entre tenants — las identidades SES son a nivel de cuenta.
        # Fail-open de rollout: si la tabla senderDomain no existe o falla el lookup, no se bloquea.
        if channelName in ("EM", "EAU", "EAP"):
            if source and not _from_allowed(customerId, source):
                return {'status': False, 'statusCode': 400,
                        'description': 'El remitente no está verificado para tu cuenta. Configura tu '
                                       'dominio o correo en "Dominios" o usa el remitente por defecto.'}
            
            

        #Opcionales
        variableDocument = event.get('variableDocument',False)
        #subject = event.get('subject','SMS')
        mask = event.get('mask','')
        attachment = event.get('attachment','')
        # Solo EAP: DOCX (combinación Word) o PDF (campos personalizados). Distinto flujo,
        # costo y lambda que arma el archivo. Se normaliza a mayúsculas.
        documentFormat = str(event.get('documentFormat', '') or '').upper() or None

        #Validar si la mascara contiene informacion para agregarla al from
        # (display-name RFC 5322: 'Nombre <correo@dominio>'). Antes la condición
        # '(not "" in mask)' era siempre falsa y la máscara nunca se aplicaba.
        if mask:
            source = f"{mask} <{source}>"

        #channel
        #1 - EAU-Email con adjunto unico
        #2 - EM-Email marketing
        #3 - SMS-Mensajes de texto
        #4 - EAP-Email con adjunto personalizad
        '''
        if (channel == "1" or channel == "2"):
            if (subject == "" or mask == ""): validData = False
        '''
            
        if (channelName == "EAU" or channelName == "EAP"):
            if (attachment == ""): validData = False

    except:
        status = False
        statusCode = 500
        description = "Error no controlado en el servicio"
    else:
        if validData:            
            while(status):
                #Consecutivo ATÓMICO del cliente (sin carrera; ya queda persistido).
                try:
                    consecutive = next_consecutive(customerId)
                except:
                    status = False
                    statusCode = 404
                    description = "Error consultando el consecutivo en la tabla campaignControl"
                    break

                #Consultar el nombre de canal para el id enviado
                '''
                try:
                    channelName = select_channelName(channel)
                except:
                    status = False
                    statusCode = 404
                    description = "Error consultando el nombre de canal en la tabla channel"
                    break

                #Realizar la creacion del template en AWS SES
                #Esta parte no deberia ir, el template se crea antes de crear la campaña
                
                try:   
                    create_template(customerId,channelName,consecutive,campaignName,subject,template)
                except:
                    status = False
                    statusCode = 500
                    description = "Error realizando la creacion del template en SES"
                    break
                '''

                # (El consecutivo ya se persistió atómicamente en next_consecutive; ya no
                #  hay un paso separado de "actualizar" — eso era lo que abría la carrera.)

                #Insertar la informacion de la campaña
                try:
                    #Voy a omitir el campo del consecutivo en el nombre de la campaña debido a que este consecutivo ya se guarda en un campo de la BD
                    #campaignName = consecutive + "_" + campaignName
                    campaignId = insert_campaign(customerId,campaignName,consecutive,channelName,dataPath,template,source,formattedDate,documentFormat,attachment_type)
                except:
                    status = False
                    statusCode = 404
                    description = "Error insertando la campaña en la tabla campaign"
                    break                

                #Insertar informacion de los adjuntos para el caso de EA-Email con adjunto
                try:
                    if (channelName == "EAU" or channelName == "EAP"):
                        print("Canal EAU o EAP (Email con adjunto personaliado o )")
                        for attach in attachment:
                            print("for")
                            path = attach.get('path')
                            insert_attachment(campaignId,attachment_type,path,variableDocument,formattedDate,documentFormat)
                except:
                    status = False
                    statusCode = 404
                    description = "Error al realizar el insert de los documentos adjuntos a la tabla document"
                    break
                break
        else:

            status = False
            statusCode = 400
            description = 'Error en la data enviada'

        # Auditar la creación (best-effort) solo si terminó bien.
        if status and campaignId:
            _audit_event(event, 'campaign.create', campaignName,
                         "Campaña {} '{}' creada (consecutivo {})".format(
                             channelName, campaignName, consecutive))

    finally:
        # Respuesta
        response = {
            'status':status,
            'statusCode': statusCode,
            'description':description,
            'data':{
                'campaignId': campaignId
            }
        }

    return response