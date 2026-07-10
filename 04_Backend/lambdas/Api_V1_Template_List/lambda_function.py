'''
Lambda para listar las plantillas SES de un cliente.

Ruta: POST /Template/List  (integración no-proxy, envelope estándar)
Request:  { customer }  (nombre de la empresa) o { customerId } (se resuelve el nombre)
Respuesta: 200 { data: { templates: [{ name, created }], count } } (desc por fecha)

Las plantillas en SES siguen la convención '{customer}_{consecutivo}_{canal}_{nombre}'
(así las crea Create-template), por eso se filtra por el prefijo del cliente: cada
cliente solo ve las suyas. Se pagina list_templates hasta agotar los resultados.
'''
import json
import boto3

REGION = 'us-east-1'

ses = boto3.client('ses', region_name=REGION)
dynamodb = boto3.resource('dynamodb')
table_customer = dynamodb.Table('customer')


def _get_payload(event):
    """Soporta integración directa (event = body) y Lambda-proxy (event['body'])."""
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _customer_name(payload):
    customer = payload.get('customer')
    if customer:
        return str(customer).strip()
    customer_id = payload.get('customerId')
    if not customer_id:
        return None
    response = table_customer.scan(
        FilterExpression="customerId = :value",
        ExpressionAttributeValues={":value": customer_id},
        ProjectionExpression='company'
    )
    if response['Items']:
        return response['Items'][0]['company']
    return None


def lambda_handler(event, context):
    payload = _get_payload(event)

    try:
        customer = _customer_name(payload)
    except Exception as e:
        print('Error resolviendo el cliente: {}'.format(e))
        customer = None

    if not customer:
        return {
            'status': False,
            'statusCode': 400,
            'description': 'Indica customer (nombre de la empresa) o customerId.',
            'data': {'templates': [], 'count': 0}
        }

    prefix = f'{customer}_'
    templates = []
    try:
        next_token = None
        while True:
            kwargs = {'MaxItems': 100}
            if next_token:
                kwargs['NextToken'] = next_token
            response = ses.list_templates(**kwargs)
            for meta in response.get('TemplatesMetadata', []):
                name = meta.get('Name', '')
                if name.startswith(prefix):
                    created = meta.get('CreatedTimestamp')
                    templates.append({
                        'name': name,
                        'created': created.strftime('%Y-%m-%dT%H:%M:%SZ') if created else ''
                    })
            next_token = response.get('NextToken')
            if not next_token:
                break

        templates.sort(key=lambda t: t['created'], reverse=True)

        return {
            'status': True,
            'statusCode': 200,
            'description': 'Plantillas del cliente',
            'data': {'templates': templates, 'count': len(templates)}
        }
    except Exception as e:
        print('Error listando plantillas SES: {}'.format(e))
        return {
            'status': False,
            'statusCode': 500,
            'description': 'Error no controlado al listar las plantillas',
            'data': {'templates': [], 'count': 0}
        }
