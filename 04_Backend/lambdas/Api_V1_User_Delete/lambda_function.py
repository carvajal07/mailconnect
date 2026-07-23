'''
Gestión de EQUIPO por el dueño (owner): eliminar un usuario de SU empresa.
Ruta: POST /User/Delete  { userId }  (no-proxy, envelope). Tenant + rol del token.

Guardas: solo el owner; el usuario debe ser de SU empresa; NO se puede eliminar a un
owner (ni a sí mismo). Borra `user` + `userData` (best-effort). Audita.
Respuesta: 200 ok · 400 · 403 · 404 · 409 (es owner / eres tú)
'''
import json
import time
import uuid

import boto3

dynamodb = boto3.resource('dynamodb')
table_user = dynamodb.Table('user')
table_userData = dynamodb.Table('userData')
_audit_table = dynamodb.Table('adminAudit')


def _get_payload(event):
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


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def _audit(event, action, target='', detail=''):
    try:
        auth = _authorizer(event)
        _audit_table.put_item(Item={
            'auditId': str(uuid.uuid4()), 'action': action,
            'actor': str(auth.get('user') or auth.get('userId') or 'owner'),
            'actorId': str(auth.get('userId') or ''), 'customer': str(auth.get('customer') or ''),
            'target': str(target), 'detail': str(detail),
            'date': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())})
    except Exception as e:
        print('No se pudo auditar: {}'.format(e))


def lambda_handler(event, context):
    auth = _authorizer(event)
    customer_id = auth.get('customerId')
    my_user_id = str(auth.get('userId') or '')
    tenant_role = str(auth.get('tenantRole', 'owner') or 'owner').lower()
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.', 'data': {}}
    if tenant_role != 'owner':
        return {'status': False, 'statusCode': 403, 'description': 'Solo el dueño puede eliminar usuarios.', 'data': {}}

    user_id = str(_get_payload(event).get('userId', '')).strip()
    if not user_id:
        return {'status': False, 'statusCode': 400, 'description': 'Falta userId.', 'data': {}}
    if user_id == my_user_id:
        return {'status': False, 'statusCode': 409, 'description': 'No puedes eliminarte a ti mismo.', 'data': {}}

    try:
        target = table_user.get_item(Key={'userId': user_id}).get('Item')
    except Exception as e:
        print('Error leyendo usuario: {}'.format(e))
        target = None
    if not target:
        return {'status': False, 'statusCode': 404, 'description': 'El usuario no existe.', 'data': {}}
    if target.get('customerId') != customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Ese usuario no pertenece a tu empresa.', 'data': {}}
    if str(target.get('tenantRole', 'owner') or 'owner').lower() == 'owner':
        return {'status': False, 'statusCode': 409, 'description': 'No puedes eliminar a un dueño.', 'data': {}}

    try:
        table_user.delete_item(Key={'userId': user_id})
    except Exception as e:
        print('Error eliminando usuario: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'No se pudo eliminar el usuario.', 'data': {}}
    # userData best-effort.
    data_id = target.get('userDataId')
    if data_id:
        try:
            table_userData.delete_item(Key={'userDataId': data_id})
        except Exception as e:
            print('No se pudo borrar userData: {}'.format(e))

    _audit(event, 'user.delete', target.get('email') or user_id, 'Usuario eliminado del equipo')
    return {'status': True, 'statusCode': 200, 'description': 'Usuario eliminado', 'data': {'userId': user_id}}
