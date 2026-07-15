'''
Lambda para crear plantillas de MENSAJE por canal no-SES: SMS, WhatsApp (WSP) y
DOCX (combinación de correspondencia). Las plantillas de correo HTML siguen viviendo
en SES (Template/Create-template); esta tabla es para los otros 3 canales.

Ruta: POST /MessageTemplate/Create  (integración no-proxy, envelope estándar)

Request (según canal):
  - SMS:  { channel:'SMS',  name, body }                 body = texto con {{variables}}
  - WSP:  { channel:'WSP',  name, hsmName, language?, params? }
                                                          hsmName = plantilla HSM de Meta
                                                          params  = etiquetas de {{1}},{{2}}…
  - DOCX: { channel:'DOCX', name, s3Path, params? }      s3Path = .docx ya subido a S3
                                                          params  = campos de combinación
  customerId/customer se prefieren del context del Authorizer (multi-tenant).

Respuesta: 201 { data: { messageTemplateId } } · 400 datos inválidos

Tabla DynamoDB: messageTemplate (PK messageTemplateId).
'''
import json
import os
import uuid
import boto3
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('messageTemplate')

VALID_CHANNELS = ('SMS', 'WSP', 'DOCX')


def _get_payload(event):
    # OJO: el canal SMS trae un campo 'body' (el texto del mensaje) que colisiona con
    # la convención Lambda-proxy (event['body'] = JSON string). Solo se interpreta como
    # proxy si event['body'] parsea a un DICT; si es texto plano (SMS), event ES el payload.
    # API Gateway (mapping template) puede inyectar el body como OBJETO JSON
    # (integración no-proxy) o como STRING (proxy). Se aceptan ambos.
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            parsed = json.loads(event['body'])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return event if isinstance(event, dict) else {}


def _tenant_from_authorizer(event):
    if not isinstance(event, dict):
        return {}
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return auth if isinstance(auth, dict) else {}




def _resolve_tenant(event, payload):
    """(customerId, customer) del token (Authorizer). Multi-tenant OBLIGATORIO:
    el tenant nunca sale del body; si el context no llega, el handler deniega."""
    # El tenant SIEMPRE sale del token (Authorizer); NUNCA del body. Si el context
    # no llega (mapping template no desplegado), devuelve None -> el handler deniega.
    a = _tenant_from_authorizer(event) or {}
    return a.get('customerId'), a.get('customer')



def lambda_handler(event, context):
    payload = _get_payload(event)
    customer_id, customer = _resolve_tenant(event, payload)
    customer = customer or ''
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.'}
    channel = str(payload.get('channel', '')).upper()
    name = str(payload.get('name', '')).strip()

    if not customer_id:
        return {'status': False, 'statusCode': 400, 'description': 'Falta el customerId.'}
    if channel not in VALID_CHANNELS:
        return {'status': False, 'statusCode': 400,
                'description': 'channel inválido. Usa SMS, WSP o DOCX.'}
    if not name:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el nombre de la plantilla.'}

    # Validaciones y campos por canal.
    body = str(payload.get('body', ''))
    hsm_name = str(payload.get('hsmName', '')).strip()
    language = str(payload.get('language', 'es')).strip() or 'es'
    s3_path = str(payload.get('s3Path', '')).strip()
    params = payload.get('params', [])
    if not isinstance(params, list):
        params = []
    params = [str(p) for p in params]

    if channel == 'SMS' and not body.strip():
        return {'status': False, 'statusCode': 400, 'description': 'La plantilla SMS necesita el texto (body).'}
    if channel == 'WSP' and not hsm_name:
        return {'status': False, 'statusCode': 400, 'description': 'La plantilla WhatsApp necesita el nombre HSM.'}
    if channel == 'DOCX' and not s3_path:
        return {'status': False, 'statusCode': 400, 'description': 'La plantilla DOCX necesita el s3Path del archivo.'}

    now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')

    # UPSERT: si viene messageTemplateId se ACTUALIZA esa plantilla (editar); si no, se crea
    # una nueva. Así "editar" reutiliza esta misma ruta sin una lambda/ruta aparte.
    incoming_id = str(payload.get('messageTemplateId', '')).strip()
    is_update = bool(incoming_id)
    message_template_id = incoming_id or str(uuid.uuid4())

    # Al actualizar, conservar la fecha de creación original (put_item reemplaza el item).
    created = now
    if is_update:
        try:
            existing = table.get_item(Key={'messageTemplateId': message_template_id}).get('Item')
        except Exception:
            existing = None
        if existing:
            # Verificar dueño: no permitir sobrescribir la plantilla de otro tenant.
            if customer_id and existing.get('customerId') and existing.get('customerId') != customer_id:
                return {'status': False, 'statusCode': 403,
                        'description': 'La plantilla no pertenece a tu cuenta.',
                        'data': {}}
            if existing.get('created'):
                created = existing['created']

    item = {
        'messageTemplateId': message_template_id,
        'customerId': customer_id,
        'customer': customer,
        'channel': channel,
        'name': name,
        'body': body,
        'hsmName': hsm_name,
        'language': language,
        's3Path': s3_path,
        'params': params,
        'created': created,
        'updated': now,
    }

    try:
        table.put_item(Item=item)
        return {
            'status': True,
            'statusCode': 200 if is_update else 201,
            'description': 'Plantilla actualizada correctamente' if is_update else 'Plantilla creada correctamente',
            'data': {'messageTemplateId': message_template_id}
        }
    except Exception as e:
        print('Error guardando la plantilla de mensaje: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al guardar la plantilla'}
