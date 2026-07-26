'''
Lambda ADMIN para configurar (o quitar) la IP de envío dedicada de un cliente
(tabla `sendingConfig`, PK `customerId`). Crea la tabla on-demand la primera vez.

Ruta: POST /SendingConfig/Set  (integración no-proxy, envelope estándar)
Request (upsert): { customerId, configurationSet, poolName?, ips?[], enabled?=true, notes? }
Request (baja):   { customerId, remove: true }  → el cliente vuelve al pool GENERAL
Respuesta: 200 ok · 400 datos inválidos

Modelo: en SES la IP dedicada vive en un POOL de IP dedicada; un CONFIGURATION SET
apunta a ese pool (delivery options → SendingPoolName). Al enviar con
ConfigurationSetName = <config set del cliente>, SES enruta por su IP dedicada. Esta
lambda solo GUARDA qué config set usa cada cliente; el ruteo lo aplican Prepare-batch
(resuelve) y Send-EM/EAU/EAP (pasan el config set a SES). La creación del pool/config
set y el traslado de las IPs dedicadas es una tarea de infraestructura en SES.

⚠️ El config set del cliente DEBE tener el mismo event destination (SNS) que 'default'
para que sigan llegando los eventos de rebote/queja a Email_ReceptionStatus.

⚠️ Endpoint administrativo: restringido a rol admin (segunda barrera JWT).
'''
import json
import time
import uuid
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
_client = boto3.client('dynamodb')
table_config = dynamodb.Table('sendingConfig')
_audit_table = dynamodb.Table('adminAudit')

TABLE_NAME = 'sendingConfig'


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


def _as_bool(v, default=True):
    if v is None:
        return default
    if isinstance(v, str):
        return v.strip().lower() in ('true', '1', 'yes', 'si', 'sí')
    return bool(v)


def _ensure_table():
    """Crea la tabla sendingConfig on-demand (PK customerId) la primera vez."""
    try:
        _client.create_table(
            TableName=TABLE_NAME,
            KeySchema=[{'AttributeName': 'customerId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'customerId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        _client.get_waiter('table_exists').wait(TableName=TABLE_NAME)
    except ClientError as ce:
        if ce.response.get('Error', {}).get('Code') != 'ResourceInUseException':
            raise


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403, 'description': 'Acceso restringido a administradores.'}
    payload = _get_payload(event)
    customer_id = str(payload.get('customerId') or '').strip()
    if not customer_id:
        return {'status': False, 'statusCode': 400, 'description': 'Indica customerId.'}

    remove = _as_bool(payload.get('remove'), default=False)

    try:
        _ensure_table()

        if remove:
            table_config.delete_item(Key={'customerId': customer_id})
            _audit(event, 'sendingConfig.remove', customer_id,
                   'IP dedicada retirada; el cliente vuelve al pool general.')
            return {
                'status': True,
                'statusCode': 200,
                'description': 'Configuración eliminada; el cliente envía por el pool general.',
                'data': {'customerId': customer_id, 'removed': True}
            }

        configuration_set = str(payload.get('configurationSet') or '').strip()
        if not configuration_set:
            return {
                'status': False,
                'statusCode': 400,
                'description': 'Indica configurationSet (o remove:true para quitar la IP dedicada).'
            }

        pool_name = str(payload.get('poolName') or '').strip()
        raw_ips = payload.get('ips') or []
        ips = [str(x).strip() for x in raw_ips if str(x).strip()][:50] if isinstance(raw_ips, list) else []
        enabled = _as_bool(payload.get('enabled'), default=True)
        notes = str(payload.get('notes') or '')[:500]
        now = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())

        item = {
            'customerId': customer_id,
            'configurationSet': configuration_set,
            'poolName': pool_name,
            'ips': ips,
            'enabled': enabled,
            'notes': notes,
            'updatedAt': now,
        }
        table_config.put_item(Item=item)
        _audit(event, 'sendingConfig.set', customer_id,
               'IP dedicada: configSet={} pool={} enabled={}'.format(
                   configuration_set, pool_name or '-', enabled))
        return {
            'status': True,
            'statusCode': 200,
            'description': 'Configuración de IP de envío guardada.',
            'data': {'customerId': customer_id, 'configurationSet': configuration_set,
                     'poolName': pool_name, 'ips': ips, 'enabled': enabled}
        }
    except Exception as e:
        print('Error guardando sendingConfig: {}'.format(e))
        return {
            'status': False,
            'statusCode': 500,
            'description': 'Error no controlado al guardar la configuración de envío'
        }
