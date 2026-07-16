'''
Lambda ADMIN: FICHA de un cliente (tabla `customer`) + sus usuarios.

Ruta: POST /Customer/Detail  (integración no-proxy, envelope estándar)
Request:  { customerId }
Respuesta: 200 { data: { customer:{customerId, company, companyTin,
                                   realSendEnabled, date},
                         users:[{userId, email, name, phone, role, tenantRole, active, date}],
                         count } }
           · 400 falta customerId · 404 no existe

Une `user` (por customerId) con `userData` (nombre/teléfono por userDataId).

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.
'''
import json
import boto3
from decimal import Decimal
from boto3.dynamodb.conditions import Attr

dynamodb = boto3.resource('dynamodb')
table_customer = dynamodb.Table('customer')
table_user = dynamodb.Table('user')
table_userData = dynamodb.Table('userData')


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


def _clean(value):
    return int(value) if isinstance(value, Decimal) else value


def _scan_all(table, **kwargs):
    items = []
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get('Items', []))
        last = resp.get('LastEvaluatedKey')
        if not last:
            break
        kwargs['ExclusiveStartKey'] = last
    return items


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}

    payload = _get_payload(event)
    customer_id = payload.get('customerId')
    if not customer_id:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el customerId.', 'data': {}}

    try:
        # customerId es la PK de customer: GetItem O(1) en vez de Scan O(tabla).
        c = table_customer.get_item(Key={'customerId': customer_id}).get('Item')
        if not c:
            return {'status': False, 'statusCode': 404, 'description': 'El cliente no existe.', 'data': {}}
        customer = {
            'customerId': c.get('customerId'),
            'company': c.get('company', ''),
            'companyTin': c.get('companyTin', ''),
            'realSendEnabled': bool(c.get('realSendEnabled', True)),
            'date': c.get('date', ''),
        }

        # Datos de perfil (nombre/teléfono) por userDataId.
        datas = _scan_all(table_userData, FilterExpression=Attr('customerId').eq(customer_id))
        by_data_id = {d.get('userDataId'): d for d in datas}

        users = []
        for u in _scan_all(table_user, FilterExpression=Attr('customerId').eq(customer_id)):
            profile = by_data_id.get(u.get('userDataId'), {})
            users.append({
                'userId': u.get('userId'),
                'email': u.get('email', ''),
                'name': profile.get('userName', ''),
                'phone': profile.get('phone', ''),
                'role': str(u.get('role', 'client')),
                # Sub-rol de empresa (RBAC): owner|approver|operator (default owner).
                'tenantRole': str(u.get('tenantRole', 'owner') or 'owner'),
                'active': bool(u.get('active', False)),
                'date': _clean(u.get('date', '')),
            })
        users.sort(key=lambda x: (x['role'] != 'admin', str(x['name']).lower()))

        return {
            'status': True, 'statusCode': 200,
            'description': 'Ficha del cliente',
            'data': {'customer': customer, 'users': users, 'count': len(users)}
        }
    except Exception as e:
        print('Error en ficha de cliente: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al obtener la ficha', 'data': {}}
