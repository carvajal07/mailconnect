'''
Lambda ADMIN para GUARDAR/ACTUALIZAR tarifas (tabla `pricingRate`).

Ruta: POST /Pricing/Update  (integración no-proxy, envelope estándar)
Request:  { customerId?, channel, fields:{...} }
    - customerId : alcance. Default '*' (tarifa GLOBAL). Un customerId de cliente
                   crea/actualiza el override de ese cliente.
    - channel    : EMAIL | SMS | WHATSAPP | VOICE | COMMON
                   COMMON escribe taxRate/minCampaign en los 4 canales (el estimador
                   los lee por canal, no de una fila COMMON).
    - fields     : mapa de campos numéricos a fijar (solo los enviados se tocan).
Respuesta: 200 ok · 400 datos inválidos

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.

Tabla DynamoDB: pricingRate (PK customerId, SK channel). Valores en COP; deben quedar
consistentes con Api_V1_Cost_Estimate / Api_V1_Pricing_List.
'''
import json
import time
import uuid
import boto3
from decimal import Decimal
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table_rates = dynamodb.Table('pricingRate')
table_customer = dynamodb.Table('customer')
_audit_table = dynamodb.Table('adminAudit')


def _company_name(customer_id):
    """Nombre de empresa para el customerId (para la auditoría legible). 'Global' para '*';
    si no se encuentra, cae al id (mejor mostrar algo que romper)."""
    if not customer_id or customer_id == '*':
        return 'Global'
    try:
        item = table_customer.get_item(Key={'customerId': customer_id}).get('Item')
        if item and item.get('company'):
            return item['company']
    except Exception:
        pass
    return customer_id


def _audit(event, action, target='', detail=''):
    """Registra una acción admin en adminAudit (best-effort; nunca rompe la operación)."""
    try:
        auth = (event.get('requestContext') or {}).get('authorizer') or {}
        _audit_table.put_item(Item={
            'auditId': str(uuid.uuid4()),
            'action': action,
            'actor': str(auth.get('user') or auth.get('userId') or 'admin'),
            'actorId': str(auth.get('userId') or ''),
            'customer': str(auth.get('customer') or ''),
            'target': str(target),
            'detail': str(detail),
            'date': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime()),
        })
    except Exception as e:
        print('No se pudo registrar auditoría: {}'.format(e))


def _fmt_num(v):
    """Formatea un número/Decimal legible (8 en vez de 8.0; conserva 0.19)."""
    if v is None:
        return '—'
    try:
        d = Decimal(str(v))
        if d == d.to_integral_value():
            return str(int(d))
        return str(d.normalize())
    except Exception:
        return str(v)


def _describe_changes(old_item, new_fields):
    """'baseEM: 8 → 10' — SOLO los campos que realmente cambiaron de valor (aunque el
    front envíe todos los campos del canal, aquí se listan únicamente los modificados)."""
    old_item = old_item or {}
    parts = []
    for k, v in new_fields.items():
        old = old_item.get(k)
        if old is not None:
            try:
                if Decimal(str(old)) == Decimal(str(v)):
                    continue  # sin cambio real → no ensuciar la bitácora
            except Exception:
                if str(old) == str(v):
                    continue
        parts.append('{}: {} → {}'.format(k, _fmt_num(old), _fmt_num(v)))
    return ', '.join(parts) if parts else 'sin cambios de valor'


CHANNELS = ('EMAIL', 'SMS', 'WHATSAPP', 'VOICE')

# Campos numéricos permitidos por canal (evita escribir basura en la tabla).
ALLOWED_FIELDS = {
    'EMAIL': {'baseEM', 'baseEAU', 'baseEAP', 'attachmentPerMB', 'personalizedPdf', 'personalizedDocx', 'taxRate', 'minCampaign'},
    'SMS': {'baseSms', 'taxRate', 'minCampaign'},
    'WHATSAPP': {'baseMarketing', 'taxRate', 'minCampaign'},
    'VOICE': {'basePerMinute', 'avgMinutes', 'taxRate', 'minCampaign'},
}
COMMON_FIELDS = {'taxRate', 'minCampaign'}


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


def _clean_fields(raw, allowed):
    """Solo campos permitidos y convertibles a número (Decimal para DynamoDB)."""
    out = {}
    if not isinstance(raw, dict):
        return out
    for k, v in raw.items():
        if k not in allowed:
            continue
        try:
            out[k] = Decimal(str(v))
        except Exception:
            continue
    return out


def _upsert(customer_id, channel, fields):
    """SET de los campos dados en la fila (customerId, channel) — la crea si no existe."""
    if not fields:
        return
    expr = 'SET ' + ', '.join(f'#{i} = :{i}' for i in range(len(fields)))
    names = {f'#{i}': k for i, k in enumerate(fields)}
    values = {f':{i}': v for i, (_, v) in enumerate(fields.items())}
    table_rates.update_item(
        Key={'customerId': customer_id, 'channel': channel},
        UpdateExpression=expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403, 'description': 'Acceso restringido a administradores.'}

    payload = _get_payload(event)
    customer_id = str(payload.get('customerId', '') or '*').strip() or '*'
    channel = str(payload.get('channel', '')).upper()
    fields_in = payload.get('fields', {})

    if channel not in CHANNELS and channel != 'COMMON':
        return {'status': False, 'statusCode': 400,
                'description': 'channel inválido. Usa EMAIL, SMS, WHATSAPP, VOICE o COMMON.'}

    try:
        if channel == 'COMMON':
            # taxRate/minCampaign se escriben en los 4 canales (el estimador los lee por canal).
            common = _clean_fields(fields_in, COMMON_FIELDS)
            if not common:
                return {'status': False, 'statusCode': 400,
                        'description': 'Envía al menos taxRate o minCampaign.'}
            # Valor anterior de referencia (EMAIL representa los comunes de los 4 canales).
            try:
                old_item = table_rates.get_item(
                    Key={'customerId': customer_id, 'channel': 'EMAIL'}).get('Item')
            except Exception:
                old_item = None
            for ch in CHANNELS:
                _upsert(customer_id, ch, common)
            touched = list(common.keys())
            change_detail = _describe_changes(old_item, common)
        else:
            fields = _clean_fields(fields_in, ALLOWED_FIELDS[channel])
            if not fields:
                return {'status': False, 'statusCode': 400,
                        'description': 'Envía al menos un campo válido para el canal.'}
            # Lee la fila actual ANTES de escribir para registrar los valores anteriores.
            try:
                old_item = table_rates.get_item(
                    Key={'customerId': customer_id, 'channel': channel}).get('Item')
            except Exception:
                old_item = None
            _upsert(customer_id, channel, fields)
            touched = list(fields.keys())
            change_detail = _describe_changes(old_item, fields)

        company = _company_name(customer_id)
        scope = 'global' if customer_id == '*' else 'cliente {}'.format(company)
        _audit(event, 'pricing.update', '{} · {}'.format(company, channel),
               'Tarifa {} ({}) — {}'.format(channel, scope, change_detail))
        return {
            'status': True, 'statusCode': 200,
            'description': 'Tarifa actualizada correctamente',
            'data': {'customerId': customer_id, 'channel': channel, 'fields': touched}
        }
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return {'status': False, 'statusCode': 500,
                    'description': 'La tabla pricingRate no existe. Créala en el despliegue.'}
        print('Error actualizando tarifa: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al guardar la tarifa'}
    except Exception as e:
        print('Error actualizando tarifa: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al guardar la tarifa'}
