'''
Lambda para eliminar una plantilla de mensaje (SMS / WSP / DOCX).

Ruta: POST /MessageTemplate/Delete  (integración no-proxy, envelope estándar)
Request:  { messageTemplateId }
Respuesta: 200 ok · 400 falta id · 403 la plantilla es de otro cliente · 404 no existe

Verifica que la plantilla pertenezca al cliente del token (Authorizer) antes de borrar.
'''
import json
import boto3

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('messageTemplate')


def _get_payload(event):
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


def lambda_handler(event, context):
    payload = _get_payload(event)
    message_template_id = payload.get('messageTemplateId')
    tenant_customer_id = _tenant_from_authorizer(event).get('customerId')

    if not message_template_id:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el messageTemplateId.'}

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
