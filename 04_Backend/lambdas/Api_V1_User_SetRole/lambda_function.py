'''
Lambda ADMIN: cambiar el ROL de un usuario (tabla `user`) entre 'admin' y 'client'.
Elimina la necesidad de promover admins a mano en la consola de DynamoDB.

Ruta: POST /User/SetRole  (integración no-proxy, envelope estándar)
Request:  { userId, role }   role ∈ admin | client
Respuesta: 200 ok · 400 datos inválidos · 404 usuario no existe
           · 409 si dejaría a la plataforma sin ningún admin

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.
Nota de seguridad: al degradar (admin→client) se verifica que quede al menos otro
admin, para no quedar sin acceso administrativo.
'''
import json
import time
import uuid
import boto3
from boto3.dynamodb.conditions import Attr

dynamodb = boto3.resource('dynamodb')
table_user = dynamodb.Table('user')
_audit_table = dynamodb.Table('adminAudit')

VALID_ROLES = ('admin', 'client')


def _audit(event, action, target='', detail=''):
    """Registra una acción admin en adminAudit (best-effort; nunca rompe la operación)."""
    try:
        auth = (event.get('requestContext') or {}).get('authorizer') or {}
        _audit_table.put_item(Item={
            'auditId': str(uuid.uuid4()),
            'action': action,
            'actor': str(auth.get('user') or auth.get('userId') or 'admin'),
            'actorId': str(auth.get('userId') or ''),
            'customer': str(auth.get('customer') or ''),
            'target': str(target),
            'detail': str(detail),
            'date': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime()),
        })
    except Exception as e:
        print('No se pudo registrar auditoría: {}'.format(e))


def _get_payload(event):
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


def _is_admin(event):
    if not isinstance(event, dict):
        return False
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return str(auth.get('role', '')).lower() == 'admin'


def _count_admins():
    """Cuántos usuarios tienen role=admin (para no quedar sin admins)."""
    count = 0
    kwargs = {'FilterExpression': Attr('role').eq('admin'), 'ProjectionExpression': 'userId'}
    while True:
        resp = table_user.scan(**kwargs)
        count += len(resp.get('Items', []))
        last = resp.get('LastEvaluatedKey')
        if not last:
            break
        kwargs['ExclusiveStartKey'] = last
    return count


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403, 'description': 'Acceso restringido a administradores.'}

    payload = _get_payload(event)
    user_id = payload.get('userId')
    role = str(payload.get('role', '')).lower().strip()

    if not user_id or role not in VALID_ROLES:
        return {'status': False, 'statusCode': 400,
                'description': 'Indica userId y role (admin | client).'}

    try:
        current = table_user.get_item(Key={'userId': user_id}).get('Item')
        if not current:
            return {'status': False, 'statusCode': 404, 'description': 'El usuario no existe.'}

        current_role = str(current.get('role', 'client')).lower()
        if current_role == role:
            return {'status': True, 'statusCode': 200,
                    'description': f'El usuario ya es {role}.',
                    'data': {'userId': user_id, 'role': role}}

        # Degradar el último admin dejaría la plataforma sin administración.
        if current_role == 'admin' and role == 'client' and _count_admins() <= 1:
            return {'status': False, 'statusCode': 409,
                    'description': 'No puedes degradar al último administrador.'}

        table_user.update_item(
            Key={'userId': user_id},
            UpdateExpression='SET #r = :role',
            ExpressionAttributeNames={'#r': 'role'},
            ExpressionAttributeValues={':role': role},
        )
        _audit(event, 'user.role', user_id, f'{current_role} → {role}')
        return {'status': True, 'statusCode': 200,
                'description': f'Rol actualizado a {role}.',
                'data': {'userId': user_id, 'role': role}}
    except Exception as e:
        print('Error cambiando rol: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al cambiar el rol'}
