'''
Lambda para listar las plantillas de mensaje (SMS / WSP / DOCX) de un cliente.

Ruta: POST /MessageTemplate/List  (integración no-proxy, envelope estándar)
Request:  { customerId, channel? }  channel opcional filtra por canal (SMS|WSP|DOCX)
Respuesta: 200 { data: { templates: [...], count } } (desc por fecha de creación)

customerId se prefiere del context del Authorizer (multi-tenant): un cliente solo ve
sus plantillas.
'''
import json
import boto3
from boto3.dynamodb.conditions import Attr

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


def lambda_handler(event, context):
    payload = _get_payload(event)
    customer_id = _tenant_from_authorizer(event).get('customerId') or payload.get('customerId')
    channel = payload.get('channel')
    channel = str(channel).upper() if channel else None

    if not customer_id:
        return {'status': False, 'statusCode': 400,
                'description': 'Indica el customerId.', 'data': {'templates': [], 'count': 0}}

    try:
        filter_expr = Attr('customerId').eq(customer_id)
        if channel:
            filter_expr = filter_expr & Attr('channel').eq(channel)

        items = []
        scan_kwargs = {'FilterExpression': filter_expr}
        while True:
            response = table.scan(**scan_kwargs)
            items.extend(response.get('Items', []))
            last_key = response.get('LastEvaluatedKey')
            if not last_key:
                break
            scan_kwargs['ExclusiveStartKey'] = last_key

        items.sort(key=lambda x: x.get('created', ''), reverse=True)

        return {
            'status': True,
            'statusCode': 200,
            'description': 'Plantillas de mensaje del cliente',
            'data': {'templates': items, 'count': len(items)}
        }
    except Exception as e:
        print('Error listando plantillas de mensaje: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al listar', 'data': {'templates': [], 'count': 0}}
