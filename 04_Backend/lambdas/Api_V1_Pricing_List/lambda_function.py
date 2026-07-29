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

# ── Interruptor GLOBAL del IVA (platformConfig · TAX_ENABLED) ────────────────
_cfg_table = dynamodb.Table('platformConfig')


def tax_enabled():
    """¿La plataforma cobra IVA? Lo decide el admin en Configuración (TAX_ENABLED).

    FAIL-OPEN a True: si la tabla o la clave no existen se mantiene el comportamiento
    histórico (cobrar 19%), de modo que desplegar este código NO cambia por sí solo lo
    que se le cobra a nadie. Solo un `false` explícito lo apaga.

    ⚠️ Este helper está COPIADO en las 6 lambdas que calculan dinero (estimador, cobro
    real, facturación, tarifas y las dos de cascada) — tienen que leer el MISMO valor:
    si el estimador y el débito discreparan, el gate de saldo decidiría con un número y
    se cobraría otro.
    """
    try:
        item = _cfg_table.get_item(Key={'configKey': 'TAX_ENABLED'}).get('Item')
    except Exception:
        return True
    if not item or item.get('value') in (None, ''):
        return True
    value = item['value']
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in ('false', '0', 'no')


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
    'SMS':      [(1, 205), (2000, 202), (5000, 199), (10000, 196), (20000, 193), (50000, 190), (100000, 187), (200000, 185), (500000, 183), (1000000, 180)],
    'WHATSAPP': [(1, 130), (2000, 125), (5000, 118), (10000, 110), (20000, 100), (50000, 90), (100000, 82), (200000, 76), (500000, 70), (1000000, 65)],
    'VOICE':    [(1, 380), (2000, 375), (5000, 370), (10000, 365), (20000, 360), (50000, 355), (100000, 350), (200000, 345), (500000, 340), (1000000, 335)],
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


# ── Gate admin con SEGUNDA BARRERA (firma del JWT) ───────────────────────────
# El context del Authorizer puede falsificarse si una ruta no-proxy queda sin
# mapping template (passthrough del body directo a la lambda). El JWT no: viene
# firmado (HS256) con SECRET_KEY. Con SECRET_KEY configurada, este gate EXIGE un
# token valido con claim role=admin (llega por el header Authorization en proxy,
# o por el campo `authToken` que inyecta el mapping template en no-proxy). Sin
# SECRET_KEY configurada se usa solo el context (compatibilidad de rollout);
# configurarla en esta lambda es requisito de despliegue (ver PENDIENTES.md).
# Verificacion manual con stdlib (hmac/base64): sin dependencia del layer PyJWT.
import base64 as _b64
import hashlib as _hashlib
import hmac as _hmac
import json as _json
import os as _os
import time as _time

_JWT_SECRET = _os.environ.get('SECRET_KEY', '')


def _jwt_claims(token):
    """Valida firma HS256 + exp del JWT con SECRET_KEY y devuelve sus claims (o None)."""
    try:
        header_b64, payload_b64, sig_b64 = str(token).split('.')

        def _dec(seg):
            return _b64.urlsafe_b64decode(seg + '=' * (-len(seg) % 4))

        expected = _hmac.new(_JWT_SECRET.encode(),
                             (header_b64 + '.' + payload_b64).encode(),
                             _hashlib.sha256).digest()
        if not _hmac.compare_digest(_dec(sig_b64), expected):
            return None
        if _json.loads(_dec(header_b64)).get('alg') != 'HS256':
            return None
        claims = _json.loads(_dec(payload_b64))
        exp = claims.get('exp')
        if exp is not None and _time.time() >= float(exp):
            return None
        return claims if isinstance(claims, dict) else None
    except Exception:
        return None


def _bearer_token(event):
    """Token de la peticion: header Authorization (proxy) o el campo `authToken`
    que inyecta el mapping template no-proxy ($input.params('Authorization'))."""
    raw = ''
    if isinstance(event, dict):
        for k, v in (event.get('headers') or {}).items():
            if str(k).lower() == 'authorization' and v:
                raw = v
                break
        if not raw:
            raw = event.get('authToken') or ''
        if not raw and isinstance(event.get('body'), dict):
            raw = event['body'].get('authToken') or ''
    raw = str(raw).strip()
    if raw.lower().startswith('bearer '):
        raw = raw[7:].strip()
    return raw


def _is_admin(event):
    if not isinstance(event, dict):
        return False
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    context_admin = str(auth.get('role', '')).lower() == 'admin'
    if not _JWT_SECRET:
        print('ADVERTENCIA: SECRET_KEY no configurada; gate admin solo por context.')
        return context_admin
    claims = _jwt_claims(_bearer_token(event))
    return bool(claims) and str(claims.get('role', '')).lower() == 'admin'

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
        # Si el IVA está APAGADO a nivel de plataforma, la tarifa efectiva que se muestra
        # en Tarifas es 0%: así el admin ve el mismo número que se le cobra al cliente y
        # no cree que el `taxRate` guardado en pricingRate sigue aplicando.
        taxing = tax_enabled()
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
            if not taxing:
                eff['taxRate'] = 0
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
                # Interruptor global del IVA: la UI lo usa para avisar que el campo IVA
                # por canal está inactivo mientras la plataforma no cobre IVA.
                'taxEnabled': taxing,
            }
        }
    except Exception as e:
        print('Error listando tarifas: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al listar las tarifas', 'data': {}}
