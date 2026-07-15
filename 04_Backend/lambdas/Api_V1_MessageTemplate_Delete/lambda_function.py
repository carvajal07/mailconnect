'''
Lambda para eliminar una plantilla de mensaje (SMS / WSP / DOCX).

Ruta: POST /MessageTemplate/Delete  (integración no-proxy, envelope estándar)
Request:  { messageTemplateId }
Respuesta: 200 ok · 400 falta id · 403 la plantilla es de otro cliente · 404 no existe

Verifica que la plantilla pertenezca al cliente del token (Authorizer) antes de borrar.
'''
import json
import os
import boto3

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('messageTemplate')


def _get_payload(event):
    # API Gateway (mapping template) puede inyectar el body como OBJETO JSON
    # (integración no-proxy) o como STRING (proxy). Se aceptan ambos.
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
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
    message_template_id = payload.get('messageTemplateId')
    tenant_customer_id, _tenant_customer = _resolve_tenant(event, payload)

    if not message_template_id:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el messageTemplateId.'}
    if not tenant_customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.'}

    try:
        current = table.get_item(Key={'messageTemplateId': message_template_id}).get('Item')
        if not current:
            return {'status': False, 'statusCode': 404, 'description': 'La plantilla no existe.'}

        # Si el token trae customerId, se exige que coincida (no borrar de otro cliente).
        if tenant_customer_id and current.get('customerId') != tenant_customer_id:
            return {'status': False, 'statusCode': 403, 'description': 'La plantilla pertenece a otro cliente.'}

        table.delete_item(Key={'messageTemplateId': message_template_id})
        return {'status': True, 'statusCode': 200, 'description': 'Plantilla eliminada correctamente'}
    except Exception as e:
        print('Error eliminando la plantilla de mensaje: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al eliminar'}
