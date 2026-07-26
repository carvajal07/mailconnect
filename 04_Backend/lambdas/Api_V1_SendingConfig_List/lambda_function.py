'''
Lambda ADMIN para listar la configuración de IP de envío dedicada por cliente
(tabla `sendingConfig`, PK `customerId`).

Ruta: POST /SendingConfig/List  (integración no-proxy, envelope estándar)
Request:  {}  (sin filtros; es un endpoint administrativo)
Respuesta: 200 { data: { configs: [{ customerId, configurationSet, poolName, ips[],
                                      enabled, notes, updatedAt }], count } }

Modelo de IP dedicada en SES: un cliente que NO está en esta tabla (o está con
enabled=false) envía por el pool GENERAL (config set por defecto, donde envían todos).
Un cliente con enabled=true envía por SU `configurationSet` (que en SES está cableado a
su pool de IP dedicada). El ruteo real lo aplica Prepare-batch (resuelve el config set)
y las lambdas Send-EM/EAU/EAP (lo pasan a SES como ConfigurationSetName).

⚠️ Endpoint administrativo: restringido a rol admin (segunda barrera JWT).
'''
import json
import boto3
from decimal import Decimal
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_config = dynamodb.Table('sendingConfig')


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


def _clean(item):
    out = {}
    for key, value in item.items():
        out[key] = int(value) if isinstance(value, Decimal) else value
    out['enabled'] = bool(item.get('enabled', True))
    out['ips'] = list(item.get('ips') or [])
    return out


def lambda_handler(event, context):
    if not _is_admin(event):
        return {
            'status': False,
            'statusCode': 403,
            'description': 'Acceso restringido a administradores.',
            'data': {'configs': [], 'count': 0}
        }
    try:
        items = []
        scan_kwargs = {}
        while True:
            response = table_config.scan(**scan_kwargs)
            items.extend(_clean(i) for i in response.get('Items', []))
            last_key = response.get('LastEvaluatedKey')
            if not last_key:
                break
            scan_kwargs['ExclusiveStartKey'] = last_key

        items.sort(key=lambda x: str(x.get('customerId', '')))
        return {
            'status': True,
            'statusCode': 200,
            'description': 'Configuración de IP de envío por cliente',
            'data': {'configs': items, 'count': len(items)}
        }
    except ClientError as ce:
        # La tabla puede no existir aún (primera vez) → lista vacía, no es error.
        if ce.response.get('Error', {}).get('Code') == 'ResourceNotFoundException':
            return {
                'status': True,
                'statusCode': 200,
                'description': 'Sin configuraciones (la tabla no existe todavía)',
                'data': {'configs': [], 'count': 0}
            }
        print('Error listando sendingConfig: {}'.format(ce))
        return {
            'status': False,
            'statusCode': 500,
            'description': 'Error no controlado al listar la configuración de envío',
            'data': {'configs': [], 'count': 0}
        }
    except Exception as e:
        print('Error listando sendingConfig: {}'.format(e))
        return {
            'status': False,
            'statusCode': 500,
            'description': 'Error no controlado al listar la configuración de envío',
            'data': {'configs': [], 'count': 0}
        }
