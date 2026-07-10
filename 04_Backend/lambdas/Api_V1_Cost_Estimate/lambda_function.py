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

# Tarifas por defecto (COP). INDICATIVAS: calibrar con costos reales de AWS/Meta.
# Se pueden sobreescribir por cliente/canal en la tabla pricingRate.
DEFAULT_RATES = {
    'EMAIL': {
        'baseEM': 8,             # correo sin adjunto (EM)
        'baseEAU': 15,           # correo con adjunto único (EAU)
        'baseEAP': 40,           # correo con adjunto personalizado (EAP), base
        'attachmentPerMB': 5,    # recargo por MB de adjunto (EAU/EAP)
        'personalizedPdf': 25,   # recargo por documento personalizado PDF (EAP)
        'personalizedDocx': 35,  # recargo por documento personalizado Word (EAP)
    },
    'SMS': {
        'baseSms': 60,           # por SMS y por segmento (160 GSM-7 / 70 unicode)
    },
    'WHATSAPP': {
        'baseMarketing': 90,     # por mensaje de plantilla de marketing
    },
    'VOICE': {
        'basePerMinute': 120,    # por minuto de llamada
        'avgMinutes': 0.5,       # minutos promedio por llamada (si no lo mandan)
    },
    'COMMON': {
        'taxRate': DEFAULT_TAX_RATE,
        'minCampaign': DEFAULT_MIN_CAMPAIGN,
    },
}

VALID_CHANNELS = ('EMAIL', 'SMS', 'WHATSAPP', 'VOICE')


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _num(value, default=0.0):
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


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
    att_type = str(payload.get('attachmentType', 'pdf')).lower()
    breakdown = []

    if mode == 'EAU':
        base = rate['baseEAU']
        breakdown.append(('Base correo con adjunto (EAU)', f'{recipients} × ${base:.0f}', base * recipients))
        surcharge = size_mb * rate['attachmentPerMB']
        if surcharge:
            breakdown.append(('Recargo por peso del adjunto', f'{size_mb:.1f} MB × ${rate["attachmentPerMB"]:.0f} × {recipients}', surcharge * recipients))
        unit = base + surcharge
    elif mode == 'EAP':
        base = rate['baseEAP']
        breakdown.append(('Base correo con adjunto personalizado (EAP)', f'{recipients} × ${base:.0f}', base * recipients))
        surcharge = size_mb * rate['attachmentPerMB']
        if surcharge:
            breakdown.append(('Recargo por peso del adjunto', f'{size_mb:.1f} MB × ${rate["attachmentPerMB"]:.0f} × {recipients}', surcharge * recipients))
        pers = rate['personalizedPdf'] if att_type == 'pdf' else rate['personalizedDocx']
        breakdown.append((f'Personalización por destinatario ({att_type.upper()})', f'{recipients} × ${pers:.0f}', pers * recipients))
        unit = base + surcharge + pers
    else:  # EM
        base = rate['baseEM']
        breakdown.append(('Base correo sin adjunto (EM)', f'{recipients} × ${base:.0f}', base * recipients))
        unit = base

    return unit, breakdown


def _estimate_sms(rate, recipients, payload):
    segments = max(1, int(_num(payload.get('smsSegments'), 1)))
    unit = rate['baseSms'] * segments
    detail = f'{recipients} × ${rate["baseSms"]:.0f}' + (f' × {segments} segmentos' if segments > 1 else '')
    return unit, [('Envío SMS', detail, unit * recipients)]


def _estimate_whatsapp(rate, recipients, payload):
    unit = rate['baseMarketing']
    return unit, [('Mensaje WhatsApp (plantilla marketing)', f'{recipients} × ${unit:.0f}', unit * recipients)]


def _estimate_voice(rate, recipients, payload):
    minutes = _num(payload.get('voiceMinutes'), rate.get('avgMinutes', 0.5))
    minutes = max(0.1, minutes)
    unit = rate['basePerMinute'] * minutes
    return unit, [('Llamada de voz', f'{recipients} × ${rate["basePerMinute"]:.0f}/min × {minutes:.2f} min', unit * recipients)]


ESTIMATORS = {
    'EMAIL': _estimate_email,
    'SMS': _estimate_sms,
    'WHATSAPP': _estimate_whatsapp,
    'VOICE': _estimate_voice,
}


def lambda_handler(event, context):
    payload = _get_payload(event)
    channel = str(payload.get('channel', 'EMAIL')).upper()
    customer_id = payload.get('customerId', '')

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
