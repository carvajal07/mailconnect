'''
Lambda ADMIN para elegir el PROVEEDOR de envío por canal, global o por cliente
(tabla `providerConfig`, PK `customerId` + SK `channel`; customerId `*` = global).

Ruta: POST /Provider/Set  (no-proxy, envelope estándar)
Request (upsert): { customerId u omitido = global, channel: EMAIL|SMS|WSP|VOZ, provider }
Request (heredar): { customerId, channel, remove: true }
Respuesta: 200 ok . 400 canal/proveedor inválido

Matriz de CAPACIDADES (qué proveedor puede atender cada canal):
  EMAIL -> aws . socketlabs     (EM masivo; EAU/EAP con adjunto caen a aws por ahora)
  SMS   -> aws . twilio . infobip
  VOZ   -> aws . twilio
  WSP   -> aws                  ADVERTENCIA: el numero de WhatsApp (WABA) esta registrado
                                con UN proveedor ante Meta; cambiarlo exige re-registrar
                                el numero, no es un swap de API. Por eso no se ofrece.

Resolución en Prepare-batch: (cliente, canal) -> (`*`, canal) -> 'aws'. FAIL-OPEN a aws:
un error leyendo esta tabla jamás detiene un envío. Las CREDENCIALES de cada proveedor
son de PLATAFORMA (env vars en las lambdas de envío: TWILIO_*, SOCKETLABS_*, INFOBIP_*),
no por cliente.

⚠️ Endpoint administrativo: restringido a rol admin (segunda barrera JWT).
'''
import json
import time
import uuid
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
_client = boto3.client('dynamodb')
table_config = dynamodb.Table('providerConfig')
_audit_table = dynamodb.Table('adminAudit')

TABLE_NAME = 'providerConfig'
GLOBAL_SCOPE = '*'
DEFAULT_PROVIDER = 'aws'

# Canal -> proveedores que pueden atenderlo. Un proveedor nuevo entra aquí Y con su
# adaptador implementado en el worker del canal — la matriz es la promesa al admin de
# que el switch funciona, no un desplegable decorativo.
CAPABILITIES = {
    'EMAIL': ['aws', 'socketlabs'],
    'SMS': ['aws', 'twilio', 'infobip'],
    'VOZ': ['aws', 'twilio'],
    'WSP': ['aws'],
}
PROVIDER_LABELS = {
    'aws': 'AWS (SES / End User Messaging)',
    'twilio': 'Twilio',
    'infobip': 'Infobip',
    'socketlabs': 'SocketLabs',
}


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _audit(event, action, target='', detail=''):
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


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


# ── Gate admin con SEGUNDA BARRERA (firma del JWT) ───────────────────────────
import base64 as _b64
import hashlib as _hashlib
import hmac as _hmac
import json as _json
import os as _os
import time as _time

_JWT_SECRET = _os.environ.get('SECRET_KEY', '')


def _jwt_claims(token):
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




def _ensure_table():
    """Crea providerConfig on-demand (PK customerId + SK channel) la primera vez."""
    try:
        _client.create_table(
            TableName=TABLE_NAME,
            KeySchema=[{'AttributeName': 'customerId', 'KeyType': 'HASH'},
                       {'AttributeName': 'channel', 'KeyType': 'RANGE'}],
            AttributeDefinitions=[{'AttributeName': 'customerId', 'AttributeType': 'S'},
                                  {'AttributeName': 'channel', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        _client.get_waiter('table_exists').wait(TableName=TABLE_NAME)
    except ClientError as ce:
        if ce.response.get('Error', {}).get('Code') != 'ResourceInUseException':
            raise


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403, 'description': 'Acceso restringido a administradores.'}
    payload = _get_payload(event)

    customer_id = str(payload.get('customerId') or '').strip() or GLOBAL_SCOPE
    channel = str(payload.get('channel') or '').strip().upper()
    if channel not in CAPABILITIES:
        return {'status': False, 'statusCode': 400,
                'description': 'Canal inválido. Usa uno de: {}.'.format(', '.join(sorted(CAPABILITIES)))}

    remove = bool(payload.get('remove'))
    try:
        _ensure_table()
        if remove:
            # Quitar la fila = volver a heredar (el cliente al global, el global a aws).
            table_config.delete_item(Key={'customerId': customer_id, 'channel': channel})
            _audit(event, 'provider.remove', '{}#{}'.format(customer_id, channel),
                   'El canal vuelve a heredar (global o aws).')
            return {'status': True, 'statusCode': 200,
                    'description': 'Configuración eliminada; el canal vuelve a heredar.',
                    'data': {'customerId': customer_id, 'channel': channel, 'removed': True}}

        provider = str(payload.get('provider') or '').strip().lower()
        permitidos = CAPABILITIES[channel]
        if provider not in permitidos:
            # ⚠️ La validación es la diferencia entre un switch y una promesa rota: si se
            # guardara un proveedor sin adaptador, el canal entero del cliente fallaría
            # en el próximo envío.
            return {'status': False, 'statusCode': 400,
                    'description': 'El canal {} solo puede enviarse por: {}.'.format(
                        channel, ', '.join(permitidos))}

        table_config.put_item(Item={
            'customerId': customer_id,
            'channel': channel,
            'provider': provider,
            'updatedAt': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime()),
        })
        _audit(event, 'provider.set', '{}#{}'.format(customer_id, channel),
               'Proveedor de {}: {} ({})'.format(
                   channel, provider,
                   'global' if customer_id == GLOBAL_SCOPE else 'cliente'))
        return {'status': True, 'statusCode': 200,
                'description': 'Proveedor de envío guardado.',
                'data': {'customerId': customer_id, 'channel': channel, 'provider': provider}}
    except Exception as e:
        print('Error guardando providerConfig: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al guardar el proveedor de envío'}
