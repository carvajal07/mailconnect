'''
Lambda ADMIN para LISTAR las tarifas (tabla `pricingRate`).

Ruta: POST /Pricing/List  (integración no-proxy, envelope estándar)
Request:  { customerId? }   customerId = alcance de la tarifa. Default '*' (tarifa
                            GLOBAL por defecto). Con un customerId de cliente, se
                            devuelven sus overrides sobre la global.
Respuesta: 200 { data: { customerId, defaults, effective, overrides, currency } }
    - defaults  : DEFAULT_RATES embebidas (lo que aplica si no hay nada en la tabla).
    - effective : lo que realmente aplicaría el estimador para ese alcance
                  (defaults → global '*' → overrides del cliente).
    - overrides : SOLO los valores guardados EXPLÍCITAMENTE en la tabla para ese
                  customerId (para que la UI distingue "heredado" de "propio").

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue (mapping
template que inyecte $context.authorizer.role, o Authorizer de admin).

Tabla DynamoDB: pricingRate (PK customerId, SK channel; customerId='*' = global).
Los valores en COP deben quedar consistentes con Api_V1_Cost_Estimate.
'''
import json
import boto3
from decimal import Decimal
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table_rates = dynamodb.Table('pricingRate')

CURRENCY = 'COP'

# Debe reflejar los DEFAULT_RATES de Api_V1_Cost_Estimate. Si cambian allá, cambian aquí.
DEFAULT_RATES = {
    'EMAIL': {
        'baseEM': 8, 'baseEAU': 15, 'baseEAP': 40,
        'attachmentPerMB': 5, 'personalizedPdf': 25, 'personalizedDocx': 35,
    },
    'SMS': {'baseSms': 60},
    'WHATSAPP': {'baseMarketing': 90},
    'VOICE': {'basePerMinute': 120, 'avgMinutes': 0.5},
    'COMMON': {'taxRate': 0.19, 'minCampaign': 5000},
}
CHANNELS = ('EMAIL', 'SMS', 'WHATSAPP', 'VOICE')


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


def _num(value, default=0.0):
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _stored_row(customer_id, channel):
    """Item guardado (sin las claves) para (customerId, channel). {} si no existe."""
    try:
        item = table_rates.get_item(Key={'customerId': customer_id, 'channel': channel}).get('Item')
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return {}
        raise
    if not item:
        return {}
    return {k: _num(v) for k, v in item.items() if k not in ('customerId', 'channel')}


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}

    payload = _get_payload(event)
    customer_id = str(payload.get('customerId', '') or '*').strip() or '*'

    try:
        defaults = {}
        effective = {}
        overrides = {}
        for channel in CHANNELS:
            base = dict(DEFAULT_RATES.get(channel, {}))
            base.update(DEFAULT_RATES['COMMON'])   # taxRate/minCampaign viven por canal
            defaults[channel] = base

            eff = dict(base)
            global_row = _stored_row('*', channel)
            eff.update(global_row)
            own_row = {}
            if customer_id != '*':
                own_row = _stored_row(customer_id, channel)
                eff.update(own_row)
            # 'overrides' = lo explícito en ESTE alcance (global si '*', si no el del cliente).
            overrides[channel] = global_row if customer_id == '*' else own_row
            effective[channel] = eff

        return {
            'status': True, 'statusCode': 200,
            'description': 'Tarifas del alcance solicitado',
            'data': {
                'customerId': customer_id,
                'currency': CURRENCY,
                'defaults': defaults,
                'effective': effective,
                'overrides': overrides,
            }
        }
    except Exception as e:
        print('Error listando tarifas: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al listar las tarifas', 'data': {}}
