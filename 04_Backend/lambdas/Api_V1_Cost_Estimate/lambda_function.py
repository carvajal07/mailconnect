'''
Lambda ESTIMADOR DE COSTOS de un envío (los 4 canales de la plataforma).

Muestra al cliente un valor ESTIMADO de la campaña antes de enviarla, para que
decida con el costo a la vista. No cobra; solo calcula.

Ruta: POST /Cost/Estimate  (integración no-proxy, envelope estándar)

Canales soportados: EMAIL (con submodo EM/EAU/EAP), SMS, WHATSAPP, VOICE.

Request:
    {
      customerId,                 # tarifa específica del cliente; cae a la global '*'
      channel,                    # EMAIL | SMS | WHATSAPP | VOICE
      recipients,                 # nº de destinatarios (obligatorio)
      # --- EMAIL ---
      emailMode,                  # EM | EAU | EAP  (default EM)
      attachmentSizeMB,           # peso del adjunto (EAU/EAP)
      attachmentType,             # pdf | docx  (EAP personalizado)
      # --- SMS ---
      smsSegments,                # nº de segmentos por SMS (default 1)
      # --- VOICE ---
      voiceMinutes                # minutos por llamada (default el de la tarifa)
    }

Respuesta: 200 { data: { currency, recipients, unitCost, subtotal, tax, taxRate,
                         estimatedCost, breakdown:[{concept,detail,amount}], isEstimate } }

Tarifas: se leen de la tabla `pricingRate` (PK customerId, SK channel; customerId='*'
= global). Si la tabla o el ítem no existen, se usan los DEFAULT_RATES de abajo, así
el estimador funciona desde el día 1. Todos los valores en COP.
'''
import json
import math
import boto3
from decimal import Decimal
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table_rates = dynamodb.Table('pricingRate')

CURRENCY = 'COP'
DEFAULT_TAX_RATE = 0.19          # IVA Colombia
DEFAULT_MIN_CAMPAIGN = 5000      # mínimo por campaña (COP)

# Tarifas por defecto (COP). El precio unitario base de cada canal es ESCALONADO por
# volumen (VOLUME_TIERS, abajo). Los `base*` aquí quedan en None = "usar el tramo por
# volumen"; si en pricingRate se guarda un valor PLANO para un canal, ese override gana
# sobre el tramo. Los recargos (attachmentPerMB / personalized*) son OPCIONALES y van en 0
# por defecto: el precio del tramo ya es "todo incluido" (coincide con la calculadora comercial).
DEFAULT_RATES = {
    'EMAIL': {
        'baseEM': None,          # None = precio por tramo (VOLUME_TIERS['EM'])
        'baseEAU': None,         # None = precio por tramo (VOLUME_TIERS['EAU'])
        'baseEAP': None,         # None = precio por tramo (VOLUME_TIERS['EAP'])
        'attachmentPerMB': 0,    # recargo OPCIONAL por MB de adjunto (default 0)
        'personalizedPdf': 0,    # recargo OPCIONAL por documento personalizado PDF (default 0)
        'personalizedDocx': 0,   # recargo OPCIONAL por documento personalizado Word (default 0)
    },
    'SMS': {
        'baseSms': None,         # None = precio por tramo (VOLUME_TIERS['SMS']), por segmento
    },
    'WHATSAPP': {
        'baseMarketing': None,   # None = precio por tramo (VOLUME_TIERS['WHATSAPP'])
    },
    'VOICE': {
        'basePerMinute': None,   # None = precio por tramo (VOLUME_TIERS['VOICE']), por minuto
        'avgMinutes': 0.5,       # minutos promedio por llamada (si no lo mandan)
    },
    'COMMON': {
        'taxRate': DEFAULT_TAX_RATE,
        'minCampaign': DEFAULT_MIN_CAMPAIGN,
    },
}

# Precio unitario por TRAMO de volumen (COP). Lista (min_destinatarios, precio_unitario).
# El precio del tramo se elige por el TOTAL de destinatarios del envío y aplica a TODO el
# envío (no marginal). Debe coincidir con la calculadora comercial (CalculadoraPrecios).
# ⚠️ SINCRONÍA: si cambian estos tramos, replicarlos en Prepare-batch, Billing_Summary y
# Pricing_List (no hay import compartido entre lambdas).
VOLUME_TIERS = {
    'EM':       [(1, 30), (2000, 28), (5000, 27), (10000, 25), (20000, 21), (50000, 19), (100000, 14), (200000, 9), (500000, 5), (1000000, 4)],
    'EAU':      [(1, 45), (2000, 42), (5000, 40), (10000, 37), (20000, 31), (50000, 28), (100000, 21), (200000, 14), (500000, 8), (1000000, 6)],
    'EAP':      [(1, 60), (2000, 55), (5000, 50), (10000, 46), (20000, 38), (50000, 33), (100000, 24), (200000, 16), (500000, 10), (1000000, 8)],
    'SMS':      [(1, 55), (2000, 50), (5000, 45), (10000, 40), (20000, 35), (50000, 28), (100000, 22), (200000, 18), (500000, 14), (1000000, 10)],
    'WHATSAPP': [(1, 130), (2000, 125), (5000, 118), (10000, 110), (20000, 100), (50000, 90), (100000, 82), (200000, 76), (500000, 70), (1000000, 65)],
    'VOICE':    [(1, 150), (2000, 140), (5000, 130), (10000, 120), (20000, 110), (50000, 95), (100000, 80), (200000, 70), (500000, 60), (1000000, 48)],
}

# Modo de entrega del documento (EAU/EAP): ONFILE (adjunto en el correo) vs ONLINE (enlace/
# botón de descarga). HOOK de precio: hoy el ONLINE se cobra IGUAL que el ONFILE (factor 1.0);
# para hacerlo más barato (refleja que S3 solo cobra a quien descarga) bajá este factor (<1.0).
ONLINE_FACTOR = 1.0

VALID_CHANNELS = ('EMAIL', 'SMS', 'WHATSAPP', 'VOICE')


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


def _tenant_customer_id(event, payload):
    """customerId con el que se resuelve la tarifa. Se PREFIERE el del token (Authorizer)
    sobre el body: así un cliente no puede estimar con el customerId de OTRO (y ver su
    tarifa/override). Solo cae al body si el context no llega (compatibilidad durante el
    rollout del mapping template; sin él, la tarifa efectiva es la global)."""
    auth = (event.get('requestContext') or {}).get('authorizer') or {} if isinstance(event, dict) else {}
    return auth.get('customerId') or payload.get('customerId', '')


def _num(value, default=0.0):
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _tier_unit(tier_key, recipients):
    """Precio unitario del TRAMO por volumen: el mayor tramo cuyo mínimo no supere a
    `recipients`. Aplica a todo el envío (no marginal)."""
    tiers = VOLUME_TIERS.get(tier_key) or []
    if not tiers:
        return 0
    unit = tiers[0][1]
    for min_qty, price in tiers:
        if recipients >= min_qty:
            unit = price
        else:
            break
    return unit


def _base_unit(rate, override_key, tier_key, recipients):
    """Precio unitario base del canal: si pricingRate trae un valor PLANO (override) para el
    canal, se usa ese; si no (None), el precio del TRAMO por volumen (VOLUME_TIERS)."""
    v = rate.get(override_key)
    if v is not None:
        return _num(v)
    return _tier_unit(tier_key, recipients)


def _load_rate(customer_id, channel):
    """Tarifa efectiva: DEFAULT_RATES[channel] + COMMON, sobreescrito por la tabla
    (primero la global '*', luego la del cliente). Nunca falla: si no hay tabla,
    usa los defaults."""
    rate = dict(DEFAULT_RATES.get(channel, {}))
    rate.update(DEFAULT_RATES['COMMON'])

    for cid in ('*', customer_id):
        if not cid:
            continue
        try:
            resp = table_rates.get_item(Key={'customerId': cid, 'channel': channel})
            item = resp.get('Item')
            if item:
                for k, v in item.items():
                    if k in ('customerId', 'channel'):
                        continue
                    rate[k] = _num(v, rate.get(k, 0))
        except ClientError as e:
            if e.response['Error']['Code'] == 'ResourceNotFoundException':
                break  # tabla no existe: usar defaults
            raise
        except Exception as e:
            print('pricingRate lookup falló ({}): {}'.format(cid, e))
    return rate


def _estimate_email(rate, recipients, payload):
    mode = str(payload.get('emailMode', 'EM')).upper()
    size_mb = max(0.0, _num(payload.get('attachmentSizeMB'), 0))
    att_type = str(payload.get('attachmentType', 'pdf')).lower()          # formato pdf/docx
    delivery = str(payload.get('attachmentDelivery', 'ONFILE')).upper()   # ONFILE / ONLINE

    if mode == 'EAU':
        base = _base_unit(rate, 'baseEAU', 'EAU', recipients)
        label = 'Base correo con adjunto (EAU)'
    elif mode == 'EAP':
        base = _base_unit(rate, 'baseEAP', 'EAP', recipients)
        label = 'Base correo con adjunto personalizado (EAP)'
    else:
        mode = 'EM'
        base = _base_unit(rate, 'baseEM', 'EM', recipients)
        label = 'Base correo sin adjunto (EM)'

    breakdown = [(label, f'{recipients} × ${base:.0f}', base * recipients)]
    unit = base

    # Recargos OPCIONALES (default 0; el precio del tramo ya es "todo incluido").
    if mode in ('EAU', 'EAP'):
        per_mb = _num(rate.get('attachmentPerMB'), 0)
        surcharge = size_mb * per_mb
        if surcharge:
            breakdown.append(('Recargo por peso del adjunto', f'{size_mb:.1f} MB × ${per_mb:.0f} × {recipients}', surcharge * recipients))
            unit += surcharge
    if mode == 'EAP':
        pers = _num(rate.get('personalizedPdf'), 0) if att_type == 'pdf' else _num(rate.get('personalizedDocx'), 0)
        if pers:
            breakdown.append((f'Personalización por destinatario ({att_type.upper()})', f'{recipients} × ${pers:.0f}', pers * recipients))
            unit += pers

    # Modo de entrega ONLINE (enlace) vs ONFILE (adjunto): hook de precio (hoy factor 1.0,
    # o sea mismo precio). Al bajar ONLINE_FACTOR (<1.0) el envío por enlace cuesta menos.
    if mode in ('EAU', 'EAP') and delivery == 'ONLINE' and ONLINE_FACTOR != 1.0:
        unit *= ONLINE_FACTOR
        breakdown = [(c, d + ' (entrega por enlace)', a * ONLINE_FACTOR) for c, d, a in breakdown]

    return unit, breakdown


def _estimate_sms(rate, recipients, payload):
    segments = max(1, int(_num(payload.get('smsSegments'), 1)))
    base = _base_unit(rate, 'baseSms', 'SMS', recipients)
    unit = base * segments
    detail = f'{recipients} × ${base:.0f}' + (f' × {segments} segmentos' if segments > 1 else '')
    return unit, [('Envío SMS', detail, unit * recipients)]


def _estimate_whatsapp(rate, recipients, payload):
    unit = _base_unit(rate, 'baseMarketing', 'WHATSAPP', recipients)
    return unit, [('Mensaje WhatsApp (plantilla marketing)', f'{recipients} × ${unit:.0f}', unit * recipients)]


def _estimate_voice(rate, recipients, payload):
    minutes = max(0.1, _num(payload.get('voiceMinutes'), rate.get('avgMinutes', 0.5)))
    base = _base_unit(rate, 'basePerMinute', 'VOICE', recipients)
    unit = base * minutes
    return unit, [('Llamada de voz', f'{recipients} × ${base:.0f}/min × {minutes:.2f} min', unit * recipients)]


ESTIMATORS = {
    'EMAIL': _estimate_email,
    'SMS': _estimate_sms,
    'WHATSAPP': _estimate_whatsapp,
    'VOICE': _estimate_voice,
}


def lambda_handler(event, context):
    payload = _get_payload(event)
    channel = str(payload.get('channel', 'EMAIL')).upper()
    # El customerId sale del token (Authorizer), no del body: evita que un cliente
    # estime con el customerId de otro y vea su tarifa.
    customer_id = _tenant_customer_id(event, payload)

    try:
        recipients = int(_num(payload.get('recipients'), 0))
    except Exception:
        recipients = 0

    if channel not in VALID_CHANNELS:
        return {'status': False, 'statusCode': 400,
                'description': 'Canal inválido. Usa EMAIL, SMS, WHATSAPP o VOICE.'}
    if recipients <= 0:
        return {'status': False, 'statusCode': 400,
                'description': 'Indica un número de destinatarios (recipients) mayor a 0.'}

    try:
        rate = _load_rate(customer_id, channel)
        unit, breakdown = ESTIMATORS[channel](rate, recipients, payload)

        subtotal = sum(amount for _, _, amount in breakdown)
        min_campaign = rate.get('minCampaign', DEFAULT_MIN_CAMPAIGN)
        applied_min = subtotal < min_campaign
        if applied_min:
            breakdown.append(('Mínimo por campaña', f'Se aplica el mínimo de ${min_campaign:.0f}', min_campaign - subtotal))
            subtotal = min_campaign

        tax_rate = rate.get('taxRate', DEFAULT_TAX_RATE)
        tax = subtotal * tax_rate
        total = subtotal + tax

        def r(x):
            return int(round(x))

        return {
            'status': True,
            'statusCode': 200,
            'description': 'Estimación calculada',
            'data': {
                'currency': CURRENCY,
                'channel': channel,
                'recipients': recipients,
                'unitCost': round(unit, 2),
                'subtotal': r(subtotal),
                'taxRate': tax_rate,
                'tax': r(tax),
                'estimatedCost': r(total),
                'appliedMinimum': applied_min,
                'breakdown': [{'concept': c, 'detail': d, 'amount': r(a)} for c, d, a in breakdown],
                'isEstimate': True,
                'note': 'Valor estimado; el cobro real puede variar según el envío efectivo.',
            }
        }
    except Exception as e:
        print('Error en estimador: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al calcular el estimado'}
