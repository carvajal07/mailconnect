'''
Lambda ADMIN: LEER la bitácora de auditoría (tabla `adminAudit`).

Registra quién hizo qué y cuándo en las acciones administrativas sensibles
(habilitar envíos, cambiar rol, tocar tarifas o configuración). Las lambdas que
mutan escriben aquí (best-effort); esta solo lee.

Ruta: POST /Admin/Audit  (integración no-proxy, envelope estándar)
Request:  { month?, action?, actor? }
    - month  : 'YYYY-MM' para acotar por fecha. Vacío = recientes.
    - action : filtra por tipo de acción (customer.realSend, user.role, ...).
    - actor  : filtra por actor (coincidencia por substring, case-insensitive).
Respuesta: 200 { data: { entries:[{auditId, date, actor, action, target, detail,
                                   customer}], count, actions[], truncated } }

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.

Tabla DynamoDB: adminAudit (PK auditId). Devuelve vacío si la tabla no existe.
'''
import json
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('adminAudit')

MAX_ENTRIES = 500  # tope de eventos devueltos (los más recientes)


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

def _scan_all(**kwargs):
    items = []
    try:
        while True:
            resp = table.scan(**kwargs)
            items.extend(resp.get('Items', []))
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return []
        raise
    return items


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}

    payload = _get_payload(event)
    month = str(payload.get('month', '') or '').strip()
    action = str(payload.get('action', '') or '').strip()
    actor = str(payload.get('actor', '') or '').strip().lower()
    # Rango de fechas para el EXPORT (YYYY-MM-DD, inclusivo). El campo date es
    # 'YYYY-MM-DD HH:MM:SS' → la comparación de strings ordena correctamente.
    date_from = str(payload.get('dateFrom', '') or '').strip()
    date_to = str(payload.get('dateTo', '') or '').strip()

    try:
        items = _scan_all()

        # Catálogo de acciones presentes (para el filtro de la UI), antes de filtrar.
        actions = sorted({str(i.get('action', '')) for i in items if i.get('action')})

        if month:
            items = [i for i in items if str(i.get('date', '')).startswith(month)]
        if date_from:
            items = [i for i in items if str(i.get('date', ''))[:10] >= date_from]
        if date_to:
            items = [i for i in items if str(i.get('date', ''))[:10] <= date_to]
        if action:
            items = [i for i in items if str(i.get('action', '')) == action]
        if actor:
            items = [i for i in items if actor in str(i.get('actor', '')).lower()]

        # Más recientes primero.
        items.sort(key=lambda i: str(i.get('date', '')), reverse=True)
        truncated = len(items) > MAX_ENTRIES
        items = items[:MAX_ENTRIES]

        entries = [{
            'auditId': i.get('auditId'),
            'date': i.get('date', ''),
            'actor': i.get('actor', ''),
            'action': i.get('action', ''),
            'target': i.get('target', ''),
            'detail': i.get('detail', ''),
            'customer': i.get('customer', ''),
        } for i in items]

        return {'status': True, 'statusCode': 200,
                'description': 'Bitácora de auditoría' + (' (parcial)' if truncated else ''),
                'data': {'entries': entries, 'count': len(entries), 'actions': actions, 'truncated': truncated}}
    except Exception as e:
        print('Error leyendo auditoría: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al leer la auditoría', 'data': {}}
