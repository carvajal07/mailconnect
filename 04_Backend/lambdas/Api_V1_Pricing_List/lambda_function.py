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
# baseX=None ⇒ el precio se toma del TRAMO por volumen (VOLUME_TIERS); un valor plano
# guardado en pricingRate para el canal SOBREESCRIBE el tramo (override).
DEFAULT_RATES = {
    'EMAIL': {
        'baseEM': None, 'baseEAU': None, 'baseEAP': None,
        'attachmentPerMB': 0, 'personalizedPdf': 0, 'personalizedDocx': 0,
    },
    'SMS': {'baseSms': None},
    'WHATSAPP': {'baseMarketing': None},
    'VOICE': {'basePerMinute': None, 'avgMinutes': 0.5},
    'COMMON': {'taxRate': 0.19, 'minCampaign': 5000},
}
# Precio unitario por TRAMO de volumen (todo incluido). Réplica de Api_V1_Cost_Estimate.
VOLUME_TIERS = {
    'EM':       [(1, 30), (2000, 28), (5000, 27), (10000, 25), (20000, 21), (50000, 19), (100000, 14), (200000, 9), (500000, 5), (1000000, 4)],
    'EAU':      [(1, 45), (2000, 42), (5000, 40), (10000, 37), (20000, 31), (50000, 28), (100000, 21), (200000, 14), (500000, 8), (1000000, 6)],
    'EAP':      [(1, 60), (2000, 55), (5000, 50), (10000, 46), (20000, 38), (50000, 33), (100000, 24), (200000, 16), (500000, 10), (1000000, 8)],
    'SMS':      [(1, 55), (2000, 50), (5000, 45), (10000, 40), (20000, 35), (50000, 28), (100000, 22), (200000, 18), (500000, 14), (1000000, 10)],
    'WHATSAPP': [(1, 130), (2000, 125), (5000, 118), (10000, 110), (20000, 100), (50000, 90), (100000, 82), (200000, 76), (500000, 70), (1000000, 65)],
    'VOICE':    [(1, 150), (2000, 140), (5000, 130), (10000, 120), (20000, 110), (50000, 95), (100000, 80), (200000, 70), (500000, 60), (1000000, 48)],
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
                # Precios escalonados por volumen (todo incluido). Si un canal no tiene
                # override plano, se cobra por estos tramos (elegidos por nº de envíos).
                'tiers': {k: [{'min': m, 'unit': u} for m, u in v] for k, v in VOLUME_TIERS.items()},
            }
        }
    except Exception as e:
        print('Error listando tarifas: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al listar las tarifas', 'data': {}}
