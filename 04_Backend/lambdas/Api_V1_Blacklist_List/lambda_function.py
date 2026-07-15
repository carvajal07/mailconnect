'''
Lambda para listar la LISTA NEGRA de un cliente (tabla {customer}_blackList, PK 'email').

La lista negra son contactos (correo o celular) a los que NO se les debe enviar. La llena
automáticamente Api_V1_Email_ReceptionStatus (rebotes permanentes) y el cliente puede
gestionarla manualmente. Prepare-batch la filtra en el envío real.

Ruta: POST /Blacklist/List  (integración no-proxy, envelope estándar)
Request:  { customer } o { customerId }  (se prefiere el context del Authorizer)
Respuesta: 200 { data: { items: [{ email, rejectionType, description, date }], count } }
'''
import json
import boto3
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table_customer = dynamodb.Table('customer')


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


def _customer_name(payload):
    """Nombre de empresa: del body directo o resuelto desde customerId."""
    customer = payload.get('customer')
    if customer:
        return str(customer).strip()
    customer_id = payload.get('customerId')
    if not customer_id:
        return None
    resp = table_customer.scan(
        FilterExpression="customerId = :v",
        ExpressionAttributeValues={":v": customer_id},
        ProjectionExpression='company')
    return resp['Items'][0]['company'] if resp['Items'] else None


def lambda_handler(event, context):
    payload = _get_payload(event)
    auth = _tenant_from_authorizer(event)
    if auth.get('customer') or auth.get('customerId'):
        payload = {'customer': auth.get('customer'), 'customerId': auth.get('customerId')}

    customer = _customer_name(payload)
    if not customer:
        return {'status': False, 'statusCode': 400,
                'description': 'Indica customer o customerId.', 'data': {'items': [], 'count': 0}}

    table = dynamodb.Table(f'{customer}_blackList')
    try:
        items = []
        kwargs = {}
        while True:
            resp = table.scan(**kwargs)
            items.extend(resp.get('Items', []))
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last
        items.sort(key=lambda x: x.get('date', ''), reverse=True)
        return {'status': True, 'statusCode': 200, 'description': 'Lista negra del cliente',
                'data': {'items': items, 'count': len(items)}}
    except ClientError as e:
        # Si la tabla no existe todavía, la lista negra está vacía (no es un error).
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return {'status': True, 'statusCode': 200, 'description': 'Lista negra vacía',
                    'data': {'items': [], 'count': 0}}
        print('Error listando la lista negra: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al listar', 'data': {'items': [], 'count': 0}}
