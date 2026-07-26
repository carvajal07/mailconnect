'''
Lambda ADMIN para actualizar el estado de un cliente (habilitar/deshabilitar los
envíos reales).

Ruta: POST /Customer/Update  (integración no-proxy, envelope estándar)
Request:  { customerId, realSendEnabled (bool) }
Respuesta: 200 ok · 400 datos inválidos · 404 cliente no existe

Cuando realSendEnabled = false, la lambda Prepare-batch bloquea el envío REAL de las
campañas de ese cliente (las muestras siguen permitidas).

⚠️ Endpoint administrativo: debe quedar restringido a un rol administrador en el
despliegue (Authorizer de admin). Pendiente [J]/seguridad: role-based access.
'''
import json
import time
import uuid
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_customer = dynamodb.Table('customer')
_audit_table = dynamodb.Table('adminAudit')


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


def _get_payload(event):
    """Soporta integración directa (event = body) y Lambda-proxy (event['body'])."""
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

def _as_bool(v):
    """Bool tolerante: acepta bool o string ('true'/'1'/'si'…) desde el mapping/proxy."""
    if isinstance(v, str):
        return v.strip().lower() in ('true', '1', 'yes', 'si', 'sí')
    return bool(v)


# Tope defensivo del número de banderas de funciones que se guardan por cliente.
_MAX_FEATURE_FLAGS = 100


def _sanitize_features(raw):
    """Normaliza el map de funciones {key: bool} recibido del admin: claves str
    acotadas, valores bool, y un tope de entradas. Devuelve {} si no es un dict."""
    if not isinstance(raw, dict):
        return {}
    out = {}
    for k, v in raw.items():
        key = str(k).strip()[:80]
        if key:
            out[key] = _as_bool(v)
        if len(out) >= _MAX_FEATURE_FLAGS:
            break
    return out


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403, 'description': 'Acceso restringido a administradores.'}
    payload = _get_payload(event)
    customer_id = payload.get('customerId')
    raw_flag = payload.get('realSendEnabled')
    features = _sanitize_features(payload.get('features'))

    if not customer_id or (raw_flag is None and not features):
        return {
            'status': False,
            'statusCode': 400,
            'description': 'Indica customerId y realSendEnabled (true/false) o features ({clave: bool}).'
        }

    try:
        # Se lee el estado actual para (a) confirmar que el cliente existe y (b) mergear
        # las banderas de funciones POR CLAVE sin pisar las demás. La carrera entre dos
        # admins editando el MISMO cliente es despreciable (panel administrativo); el
        # UpdateItem posterior lleva ConditionExpression para no crear un ítem fantasma.
        old = table_customer.get_item(Key={'customerId': customer_id}).get('Item')
        if not old:
            return {'status': False, 'statusCode': 404, 'description': 'El cliente no existe.'}
        company = old.get('company') or customer_id

        set_parts = []
        values = {}
        real_send_enabled = None
        if raw_flag is not None:
            real_send_enabled = _as_bool(raw_flag)
            set_parts.append('realSendEnabled = :rse')
            values[':rse'] = real_send_enabled

        merged_flags = {str(k): bool(v) for k, v in (old.get('featureFlags') or {}).items()}
        if features:
            merged_flags.update(features)
            set_parts.append('featureFlags = :ff')
            values[':ff'] = merged_flags

        try:
            table_customer.update_item(
                Key={'customerId': customer_id},
                UpdateExpression='SET ' + ', '.join(set_parts),
                ConditionExpression='attribute_exists(customerId)',
                ExpressionAttributeValues=values,
            )
        except ClientError as ce:
            if ce.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException':
                return {'status': False, 'statusCode': 404, 'description': 'El cliente no existe.'}
            raise

        # Auditoría + descripción según lo que se tocó.
        parts = []
        if real_send_enabled is not None:
            prev = old.get('realSendEnabled')
            prev_lbl = 'habilitados' if prev else ('deshabilitados' if prev is not None else 'sin definir')
            estado = 'habilitados' if real_send_enabled else 'deshabilitados'
            _audit(event, 'customer.realSend', company,
                   'Envíos reales del cliente {}: {} → {}'.format(company, prev_lbl, estado))
            parts.append('envíos reales {}'.format(estado))
        if features:
            resumen = ', '.join('{}={}'.format(k, 'on' if v else 'off') for k, v in features.items())
            _audit(event, 'customer.features', company,
                   'Funciones del cliente {}: {}'.format(company, resumen))
            parts.append('funciones actualizadas ({})'.format(len(features)))

        return {
            'status': True,
            'statusCode': 200,
            'description': 'Cliente actualizado: ' + (' y '.join(parts) if parts else 'sin cambios') + '.',
            'data': {
                'customerId': customer_id,
                'realSendEnabled': real_send_enabled if real_send_enabled is not None
                                    else bool(old.get('realSendEnabled', True)),
                'featureFlags': merged_flags,
            }
        }
    except Exception as e:
        print('Error actualizando el cliente: {}'.format(e))
        return {
            'status': False,
            'statusCode': 500,
            'description': 'Error no controlado al actualizar el cliente'
        }
