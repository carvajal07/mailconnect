'''
Gestión de EQUIPO por el dueño (owner): crear un usuario dentro de SU empresa.

Reemplaza el viejo auto-registro bajo un NIT existente (que era una fuga entre tenants).
Solo el `owner` de la empresa puede sumar usuarios, con un TOPE (default 2, sin contar al
owner). Los sub-roles son `operator` (prepara/prueba) y `approver` (aprueba/envía real).

El usuario nuevo queda **activo** pero SIN contraseña usable (hash aleatorio): define su
clave con "¿Olvidaste tu contraseña?" (OTP) — el front dispara ese correo tras crearlo.
Así el dueño nunca maneja contraseñas ajenas y se reutiliza el flujo de recuperación.

Ruta: POST /User/Create  (no-proxy, envelope). Tenant + rol del token (Authorizer).
Request:  { name, email, phone?, tenantRole: 'operator'|'approver' }
Respuesta: 201 { data:{userId, email} } · 400 · 403 (no owner) · 409 (email existe / tope)
'''
import hashlib
import json
import os
import re
import time
import uuid
from datetime import datetime

import boto3
from boto3.dynamodb.conditions import Attr

dynamodb = boto3.resource('dynamodb')
table_user = dynamodb.Table('user')
table_userData = dynamodb.Table('userData')
_audit_table = dynamodb.Table('adminAudit')

MAX_TEAM_USERS = int(os.environ.get('MAX_TEAM_USERS', '2'))   # sin contar al owner
PBKDF2_ITERATIONS = int(os.environ.get('PBKDF2_ITERATIONS', '100000'))
TEAM_ROLES = ('operator', 'approver')
PATRON_EMAIL = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'


def _hash_password(password, salt):
    dk = hashlib.pbkdf2_hmac('sha256', str(password).encode(), str(salt).encode(), PBKDF2_ITERATIONS)
    return 'pbkdf2${}${}'.format(PBKDF2_ITERATIONS, dk.hex())


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


def _email_taken(email):
    try:
        r = table_user.scan(FilterExpression='email = :e',
                            ExpressionAttributeValues={':e': email}, ProjectionExpression='email')
        return bool(r.get('Items'))
    except Exception as e:
        print('No se pudo verificar el email: {}'.format(e))
        return False


def _count_team(customer_id):
    """Usuarios del tenant que NO son owner (cuentan para el tope)."""
    count = 0
    kwargs = {'FilterExpression': Attr('customerId').eq(customer_id) & Attr('tenantRole').ne('owner'),
              'ProjectionExpression': 'userId'}
    while True:
        r = table_user.scan(**kwargs)
        count += len(r.get('Items', []))
        if not r.get('LastEvaluatedKey'):
            break
        kwargs['ExclusiveStartKey'] = r['LastEvaluatedKey']
    return count


def lambda_handler(event, context):
    auth = _authorizer(event)
    customer_id = auth.get('customerId')
    tenant_role = str(auth.get('tenantRole', 'owner') or 'owner').lower()
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.', 'data': {}}
    if tenant_role != 'owner':
        return {'status': False, 'statusCode': 403,
                'description': 'Solo el dueño de la empresa puede crear usuarios.', 'data': {}}

    payload = _get_payload(event)
    name = str(payload.get('name', '')).strip()
    email = str(payload.get('email', '')).strip().lower()
    phone = str(payload.get('phone', '')).strip()
    new_role = str(payload.get('tenantRole', 'operator')).lower().strip()

    if not name:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el nombre del usuario.', 'data': {}}
    if not re.match(PATRON_EMAIL, email):
        return {'status': False, 'statusCode': 400, 'description': 'Correo inválido.', 'data': {}}
    if new_role not in TEAM_ROLES:
        return {'status': False, 'statusCode': 400,
                'description': 'El rol debe ser operator (funcional) o approver (aprobador).', 'data': {}}

    if _count_team(customer_id) >= MAX_TEAM_USERS:
        return {'status': False, 'statusCode': 409,
                'description': 'Alcanzaste el máximo de {} usuarios además del dueño. Elimina uno para agregar otro.'.format(MAX_TEAM_USERS),
                'data': {}}
    if _email_taken(email):
        return {'status': False, 'statusCode': 409, 'description': 'Ese correo ya está registrado.', 'data': {}}

    now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    user_id = str(uuid.uuid4())
    user_data_id = str(uuid.uuid4())
    salt = str(uuid.uuid4())
    # Contraseña ALEATORIA no usable: el usuario define la suya con OTP (forgot-password).
    unusable = _hash_password(str(uuid.uuid4()), salt)

    try:
        table_userData.put_item(Item={
            'userDataId': user_data_id, 'customerId': customer_id,
            'userName': name, 'phone': phone, 'date': now})
        table_user.put_item(Item={
            'userId': user_id, 'userDataId': user_data_id, 'customerId': customer_id,
            'email': email, 'userHash': unusable, 'userSalt': salt,
            'role': 'client', 'tenantRole': new_role,
            'active': True, 'mustSetPassword': True,
            'createdBy': str(auth.get('userId') or ''), 'date': now})
    except Exception as e:
        print('Error creando el usuario: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'No se pudo crear el usuario.', 'data': {}}

    _audit(event, 'user.create', email, 'Usuario {} creado como {}'.format(email, new_role))
    return {'status': True, 'statusCode': 201,
            'description': 'Usuario creado. Le enviamos un correo para que defina su contraseña.',
            'data': {'userId': user_id, 'email': email, 'tenantRole': new_role}}
