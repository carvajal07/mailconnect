'''
Lambda para QUITAR un contacto de la lista negra de un cliente
(tabla {customer}_blackList, PK 'email').

Ruta: POST /Blacklist/Delete  (integración no-proxy, envelope estándar)
Request:  { email (contacto) } + customer/customerId del Authorizer
Respuesta: 200 ok · 400 datos inválidos · 404 no estaba en la lista

Al quitarlo, el contacto vuelve a poder recibir envíos.
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


def _customer_name(auth, payload):
    customer = auth.get('customer') or payload.get('customer')
    if customer:
        return str(customer).strip()
    customer_id = auth.get('customerId') or payload.get('customerId')
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

    contact = str(payload.get('email', '')).strip()
    if not contact:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el contacto a quitar.'}

    customer = _customer_name(auth, payload)
    if not customer:
        return {'status': False, 'statusCode': 400, 'description': 'Indica customer o customerId.'}

    table = dynamodb.Table(f'{customer}_blackList')
    try:
        existing = table.get_item(Key={'email': contact}).get('Item')
        if not existing:
            return {'status': False, 'statusCode': 404, 'description': 'El contacto no está en la lista negra.'}
        table.delete_item(Key={'email': contact})
        return {'status': True, 'statusCode': 200, 'description': 'Contacto quitado de la lista negra.'}
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return {'status': False, 'statusCode': 404, 'description': 'El contacto no está en la lista negra.'}
        print('Error quitando de la lista negra: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al quitar'}
