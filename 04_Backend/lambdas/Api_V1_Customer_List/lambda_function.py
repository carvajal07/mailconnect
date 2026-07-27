'''
Lambda ADMIN para listar los clientes (tabla `customer`).

Ruta: POST /Customer/List  (integración no-proxy, envelope estándar)
Request:  {}  (sin filtros; es un endpoint administrativo)
Respuesta: 200 { data: { customers: [{ customerId, company, companyTin,
                                        realSendEnabled, date }], count } }

⚠️ Este endpoint devuelve TODOS los clientes (no está acotado por tenant), por eso
debe quedar restringido a un rol administrador en el despliegue (Authorizer de admin
o ruta separada). Pendiente [J]/seguridad: role-based access.
'''
import json
import boto3
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
table_customer = dynamodb.Table('customer')


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

def _clean(item):
    """Normaliza el item para JSON: Decimal → int, y realSendEnabled por defecto True."""
    out = {}
    for key, value in item.items():
        out[key] = int(value) if isinstance(value, Decimal) else value
    # Clientes antiguos sin el campo se consideran habilitados (fail-open).
    out['realSendEnabled'] = bool(item.get('realSendEnabled', True))
    # Banderas de funciones por cliente ({key: bool}); ausente = todo habilitado.
    flags = item.get('featureFlags') or {}
    out['featureFlags'] = {str(k): bool(v) for k, v in flags.items()} if isinstance(flags, dict) else {}
    # Cuotas de envío ({maxPerCampaign, maxPerDay}); ausente/0 = sin tope.
    lim = item.get('sendingLimits') or {}
    out['sendingLimits'] = ({k: int(v or 0) for k, v in lim.items()}
                            if isinstance(lim, dict) else {})
    return out


def lambda_handler(event, context):
    if not _is_admin(event):
        return {
            'status': False,
            'statusCode': 403,
            'description': 'Acceso restringido a administradores.',
            'data': {'customers': [], 'count': 0}
        }
    try:
        items = []
        scan_kwargs = {
            'ProjectionExpression': 'customerId, company, companyTin, realSendEnabled, featureFlags, sendingLimits, #d',
            'ExpressionAttributeNames': {'#d': 'date'},
        }
        while True:
            response = table_customer.scan(**scan_kwargs)
            items.extend(_clean(i) for i in response.get('Items', []))
            last_key = response.get('LastEvaluatedKey')
            if not last_key:
                break
            scan_kwargs['ExclusiveStartKey'] = last_key

        # Orden alfabético por empresa para la tabla del admin.
        items.sort(key=lambda x: str(x.get('company', '')).lower())

        return {
            'status': True,
            'statusCode': 200,
            'description': 'Clientes registrados',
            'data': {'customers': items, 'count': len(items)}
        }
    except Exception as e:
        print('Error listando clientes: {}'.format(e))
        return {
            'status': False,
            'statusCode': 500,
            'description': 'Error no controlado al listar los clientes',
            'data': {'customers': [], 'count': 0}
        }
