'''
Lambda ADMIN: LEER la configuración de plataforma (tabla `platformConfig`).

Centraliza ajustes globales que antes vivían como variables de entorno sueltas por
lambda. Devuelve el catálogo de ajustes conocidos (SCHEMA) con su valor actual
(guardado o por defecto), agrupados para la UI.

Ruta: POST /Config/Get  (integración no-proxy, envelope estándar)
Request:  {}
Respuesta: 200 { data: { settings:[{key, label, group, type, default, help,
                                    consumers[], value, isOverridden}] } }

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.

Los ajustes marcados aquí SÍ los consumen sus lambdas (leen platformConfig con
fallback a su env var). Tabla: platformConfig (PK configKey; attr value).
'''
import json
import boto3
from decimal import Decimal
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('platformConfig')

# Catálogo de ajustes conocidos. `consumers` = lambdas que YA lo leen (con fallback a env).
SCHEMA = [
    {'key': 'SENDER_EMAIL', 'label': 'Remitente de correos', 'group': 'Correo', 'type': 'email',
     'default': 'comunicaciones@mailconnect.com.co',
     'help': 'Dirección "From" de los correos transaccionales (activación, OTP, recuperación).',
     'consumers': ['Register', 'Create-otp', 'Recovery-password']},
    {'key': 'ACTIVATION_URL', 'label': 'URL de activación', 'group': 'Correo', 'type': 'string',
     'default': 'https://mtgt9qpb77.execute-api.us-east-1.amazonaws.com/Test/api/account-activation',
     'help': 'Endpoint público al que apunta el botón "Activar mi cuenta" del correo de registro.',
     'consumers': ['Register']},
    {'key': 'OTP_EXPIRATION_MIN', 'label': 'Vigencia del OTP (minutos)', 'group': 'Seguridad', 'type': 'number',
     'default': 5,
     'help': 'Minutos de validez de los códigos OTP (verificación y recuperación).',
     'consumers': ['Create-otp', 'Recovery-password']},
]


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

def _coerce(value, type_):
    if isinstance(value, Decimal):
        value = int(value) if value % 1 == 0 else float(value)
    if type_ == 'number':
        try:
            return int(value) if float(value) % 1 == 0 else float(value)
        except (TypeError, ValueError):
            return value
    return value


def _stored():
    """Todos los ítems guardados: {configKey: value}. {} si la tabla no existe."""
    out = {}
    try:
        resp = table.scan(ProjectionExpression='configKey, #v', ExpressionAttributeNames={'#v': 'value'})
        for it in resp.get('Items', []):
            out[it.get('configKey')] = it.get('value')
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return {}
        raise
    return out


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}
    try:
        stored = _stored()
        settings = []
        for s in SCHEMA:
            has = s['key'] in stored and stored[s['key']] not in (None, '')
            value = _coerce(stored[s['key']], s['type']) if has else s['default']
            settings.append({**s, 'value': value, 'isOverridden': has})
        return {'status': True, 'statusCode': 200,
                'description': 'Configuración de plataforma', 'data': {'settings': settings}}
    except Exception as e:
        print('Error leyendo configuración: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al leer la configuración', 'data': {}}
