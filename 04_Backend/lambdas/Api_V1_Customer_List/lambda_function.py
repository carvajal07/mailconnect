'''
Lambda ADMIN para listar los clientes (tabla `customer`).

Ruta: POST /Customer/List  (integración no-proxy, envelope estándar)
Request:  {}  (sin filtros; es un endpoint administrativo)
Respuesta: 200 { data: { customers: [{ customerId, company, companyTin,
                                        realSendEnabled, date }], count } }

⚠️ Este endpoint devuelve TODOS los clientes (no está acotado por tenant), por eso
debe quedar restringido a un rol administrador en el despliegue (Authorizer de admin
o ruta separada). Pendiente [J]/seguridad: role-based access.
'''
import json
import boto3
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
table_customer = dynamodb.Table('customer')


def _is_admin(event):
    """El rol viaja en el context del Authorizer (event.requestContext.authorizer.role).
    Solo un administrador puede usar este endpoint."""
    if not isinstance(event, dict):
        return False
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return str(auth.get('role', '')).lower() == 'admin'


def _clean(item):
    """Normaliza el item para JSON: Decimal → int, y realSendEnabled por defecto True."""
    out = {}
    for key, value in item.items():
        out[key] = int(value) if isinstance(value, Decimal) else value
    # Clientes antiguos sin el campo se consideran habilitados (fail-open).
    out['realSendEnabled'] = bool(item.get('realSendEnabled', True))
    return out


def lambda_handler(event, context):
    if not _is_admin(event):
        return {
            'status': False,
            'statusCode': 403,
            'description': 'Acceso restringido a administradores.',
            'data': {'customers': [], 'count': 0}
        }
    try:
        items = []
        scan_kwargs = {
            'ProjectionExpression': 'customerId, company, companyTin, realSendEnabled, #d',
            'ExpressionAttributeNames': {'#d': 'date'},
        }
        while True:
            response = table_customer.scan(**scan_kwargs)
            items.extend(_clean(i) for i in response.get('Items', []))
            last_key = response.get('LastEvaluatedKey')
            if not last_key:
                break
            scan_kwargs['ExclusiveStartKey'] = last_key

        # Orden alfabético por empresa para la tabla del admin.
        items.sort(key=lambda x: str(x.get('company', '')).lower())

        return {
            'status': True,
            'statusCode': 200,
            'description': 'Clientes registrados',
            'data': {'customers': items, 'count': len(items)}
        }
    except Exception as e:
        print('Error listando clientes: {}'.format(e))
        return {
            'status': False,
            'statusCode': 500,
            'description': 'Error no controlado al listar los clientes',
            'data': {'customers': [], 'count': 0}
        }
