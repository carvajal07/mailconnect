'''
Gestión de EQUIPO por el dueño (owner): listar los usuarios de SU empresa.
Ruta: POST /User/List  {}  (no-proxy, envelope). Tenant + rol del token.
Respuesta: 200 { data:{ users:[{userId, name, email, tenantRole, active, isOwner}], count,
                        max, canAdd } } · 403 (no owner)
'''
import json
import os

import boto3
from boto3.dynamodb.conditions import Attr

dynamodb = boto3.resource('dynamodb')
table_user = dynamodb.Table('user')
table_userData = dynamodb.Table('userData')
MAX_TEAM_USERS = int(os.environ.get('MAX_TEAM_USERS', '2'))


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def _scan(table, **kwargs):
    items = []
    while True:
        r = table.scan(**kwargs)
        items.extend(r.get('Items', []))
        if not r.get('LastEvaluatedKey'):
            break
        kwargs['ExclusiveStartKey'] = r['LastEvaluatedKey']
    return items


def lambda_handler(event, context):
    auth = _authorizer(event)
    customer_id = auth.get('customerId')
    tenant_role = str(auth.get('tenantRole', 'owner') or 'owner').lower()
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.',
                'data': {'users': [], 'count': 0}}
    if tenant_role != 'owner':
        return {'status': False, 'statusCode': 403, 'description': 'Solo el dueño puede ver el equipo.',
                'data': {'users': [], 'count': 0}}

    try:
        users = _scan(table_user, FilterExpression=Attr('customerId').eq(customer_id),
                      ProjectionExpression='userId, email, userDataId, tenantRole, active')
        # Nombres desde userData.
        names = {}
        for ud in _scan(table_userData, FilterExpression=Attr('customerId').eq(customer_id),
                        ProjectionExpression='userDataId, userName'):
            names[ud.get('userDataId')] = ud.get('userName', '')
    except Exception as e:
        print('Error listando usuarios: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error al listar', 'data': {'users': [], 'count': 0}}

    out = []
    team_count = 0
    for u in users:
        role = str(u.get('tenantRole', 'owner') or 'owner').lower()
        is_owner = role == 'owner'
        if not is_owner:
            team_count += 1
        out.append({
            'userId': u.get('userId'),
            'name': names.get(u.get('userDataId'), ''),
            'email': u.get('email'),
            'tenantRole': role,
            'active': bool(u.get('active', False)),
            'isOwner': is_owner,
        })
    out.sort(key=lambda x: (not x['isOwner'], x['email'] or ''))
    return {'status': True, 'statusCode': 200, 'description': 'Usuarios de la empresa',
            'data': {'users': out, 'count': len(out), 'max': MAX_TEAM_USERS,
                     'canAdd': team_count < MAX_TEAM_USERS}}
