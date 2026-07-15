'''
Lambda para listar las campañas de un cliente.

Ruta: POST /Campaign/List  (integración no-proxy, envelope estándar)
Request:  { customerId }
Respuesta: 200 { data: { campaigns: [...], count } } ordenadas por fecha (desc)

Cada campaña incluye: campaignId, campaignName, consecutive, channel,
campaignState, dataPath, template, originEmail, date.
'''
import json
import os
import boto3
from decimal import Decimal
from boto3.dynamodb.conditions import Attr

dynamodb = boto3.resource('dynamodb')
table_campaign = dynamodb.Table('campaign')


def _get_payload(event):
    """Soporta integración directa (event = body) y Lambda-proxy (event['body'])."""
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _tenant_from_authorizer(event):
    """customerId/customer que el Authorizer inyecta en el context (CONFIABLE).
    Con integración proxy llega en event.requestContext.authorizer; en no-proxy
    depende de que el mapping template reenvíe $context.authorizer.*. Se prefiere
    sobre el body para evitar que un cliente consulte datos de otro (multi-tenant).
    """
    if not isinstance(event, dict):
        return {}
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return auth if isinstance(auth, dict) else {}


def _clean(item):
    """DynamoDB devuelve los números como Decimal; se pasan a int para el JSON."""
    out = {}
    for key, value in item.items():
        out[key] = int(value) if isinstance(value, Decimal) else value
    return out


STRICT_TENANT = os.environ.get('STRICT_TENANT', 'false').strip().lower() == 'true'


def _resolve_tenant(event, payload):
    """(customerId, customer) a usar en la consulta.
    Si el Authorizer trae identidad, se usa SOLO esa (ignora el body por completo
    para no mezclar tenants). Sin contexto del Authorizer cae al body (legacy)
    salvo STRICT_TENANT=true, que corta el acceso (fail-closed). Actívalo cuando
    el mapping template que inyecta $context.authorizer.* esté desplegado."""
    a = _tenant_from_authorizer(event) or {}
    cid, cust = a.get('customerId'), a.get('customer')
    if cid or cust:
        return cid, cust
    if STRICT_TENANT:
        return None, None
    return payload.get('customerId'), payload.get('customer')



def lambda_handler(event, context):
    payload = _get_payload(event)
    # Identidad del token (Authorizer); ignora el body si el token trae identidad.
    customer_id, _customer = _resolve_tenant(event, payload)

    if not customer_id:
        return {
            'status': False,
            'statusCode': 400,
            'description': 'Indica el customerId.',
            'data': {'campaigns': [], 'count': 0}
        }

    try:
        items = []
        scan_kwargs = {'FilterExpression': Attr('customerId').eq(customer_id)}
        while True:
            response = table_campaign.scan(**scan_kwargs)
            items.extend(_clean(i) for i in response.get('Items', []))
            last_key = response.get('LastEvaluatedKey')
            if not last_key:
                break
            scan_kwargs['ExclusiveStartKey'] = last_key

        # Orden descendente por fecha ('YYYY-MM-DD HH:MM:SS' ordena como texto).
        items.sort(key=lambda x: x.get('date', ''), reverse=True)

        return {
            'status': True,
            'statusCode': 200,
            'description': 'Campañas del cliente',
            'data': {'campaigns': items, 'count': len(items)}
        }
    except Exception as e:
        print('Error listando campañas: {}'.format(e))
        return {
            'status': False,
            'statusCode': 500,
            'description': 'Error no controlado al listar las campañas',
            'data': {'campaigns': [], 'count': 0}
        }
