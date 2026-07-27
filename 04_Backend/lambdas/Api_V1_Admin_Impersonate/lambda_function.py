'''
Lambda ADMIN: IMPERSONACIÓN AUDITADA — "ver como cliente" para soporte (Bloque D).

Emite un token de SESIÓN del TENANT (customerId/customer/nit del cliente) para que el
admin vea el portal EXACTAMENTE como lo ve ese cliente, pero en modo **solo lectura** y
con todo auditado. El token es deliberadamente de bajo privilegio y no permite las
acciones peligrosas:
  - role='client'   → no abre /admin.
  - tenantRole='operator' → los gates RBAC de sub-rol (aprobar/rechazar/programar/ENVÍO
    REAL) ya bloquean a un operator (fail-closed), así que la impersonación no puede gastar
    saldo ni disparar campañas.
  - readonly=true + impersonatedBy=<admin> → el Authorizer los reenvía en el context;
    Prepare-batch (y otras escrituras sensibles) rechazan readonly=true; el FRONT entra en
    modo solo-lectura con un banner visible.
  - exp corto (IMPERSONATION_TTL_MIN, default 30 min) y `sid` de una sesión real (revocable).

Ruta: POST /Admin/Impersonate  (no-proxy, envelope; admin-only + 2ª barrera JWT)
Request:  { customerId }
Respuesta: 200 `data:{ token, customer, customerId, companyTin, expiresInMinutes,
  impersonatedBy }` · 400 falta customerId · 404 cliente no existe.

Audita `support.impersonate` (quién impersonó a qué empresa).

[J]: ruta admin `/Admin/Impersonate` + env `SECRET_KEY` (firma el token + 2ª barrera).
IAM: `GetItem customer`, `PutItem session`, `PutItem adminAudit`.
'''
import os
import json
import time
import uuid
import base64
import hashlib
import hmac
from datetime import datetime

import boto3

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table_customer = dynamodb.Table('customer')
table_session = dynamodb.Table('session')
_audit_table = dynamodb.Table('adminAudit')

SECRET_KEY = os.environ.get('SECRET_KEY', '')
IMPERSONATION_TTL_MIN = int(os.environ.get('IMPERSONATION_TTL_MIN', '30'))


def _get_payload(event):
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


# ── Gate admin con SEGUNDA BARRERA (firma del JWT) + identidad del admin ──────
def _jwt_claims(token):
    try:
        header_b64, payload_b64, sig_b64 = str(token).split('.')

        def _dec(seg):
            return base64.urlsafe_b64decode(seg + '=' * (-len(seg) % 4))

        expected = hmac.new(SECRET_KEY.encode(),
                            (header_b64 + '.' + payload_b64).encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(_dec(sig_b64), expected):
            return None
        if json.loads(_dec(header_b64)).get('alg') != 'HS256':
            return None
        claims = json.loads(_dec(payload_b64))
        exp = claims.get('exp')
        if exp is not None and time.time() >= float(exp):
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


def _admin_identity(event):
    """(es_admin, adminEmail, adminUserId). Con SECRET_KEY exige la firma del JWT
    (2ª barrera); sin ella cae al context (rollout). Devuelve la identidad del admin
    para dejar traza de QUIÉN impersonó."""
    auth = ((event or {}).get('requestContext') or {}).get('authorizer') or {}
    ctx_email = str(auth.get('user', '') or '')
    ctx_uid = str(auth.get('userId', '') or '')
    if not SECRET_KEY:
        print('ADVERTENCIA: SECRET_KEY no configurada; gate admin solo por context.')
        return (str(auth.get('role', '')).lower() == 'admin', ctx_email, ctx_uid)
    claims = _jwt_claims(_bearer_token(event))
    if not claims or str(claims.get('role', '')).lower() != 'admin':
        return (False, ctx_email, ctx_uid)
    return (True, str(claims.get('user', '') or ctx_email),
            str(claims.get('userId', '') or ctx_uid))


def _b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def _make_token(customer_id, customer, nit, admin_user, admin_user_id, session_id):
    """JWT HS256 (stdlib) de IMPERSONACIÓN: claims del tenant + readonly + impersonatedBy."""
    now = int(time.time())
    claims = {
        'user': admin_user,          # el ACTOR real (para trazas)
        'customerId': customer_id, 'customer': customer, 'nit': str(nit or ''),
        'userId': admin_user_id,
        'role': 'client',            # nunca abre /admin
        'tenantRole': 'operator',    # mínimo privilegio (RBAC bloquea aprobar/enviar)
        'readonly': True,            # bloquea escrituras sensibles
        'impersonatedBy': admin_user,
        'sid': session_id,
        'iat': now, 'exp': now + IMPERSONATION_TTL_MIN * 60,
    }
    header = _b64url(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())
    payload = _b64url(json.dumps(claims).encode())
    sig = hmac.new(SECRET_KEY.encode(), (header + '.' + payload).encode(), hashlib.sha256).digest()
    return header + '.' + payload + '.' + _b64url(sig)


def _audit(admin_user, admin_user_id, company, detail):
    try:
        _audit_table.put_item(Item={
            'auditId': str(uuid.uuid4()), 'action': 'support.impersonate',
            'actor': str(admin_user or 'admin'), 'actorId': str(admin_user_id or ''),
            'customer': str(company or ''), 'target': str(company or ''),
            'detail': str(detail), 'date': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())})
    except Exception as e:
        print('No se pudo auditar la impersonación: {}'.format(e))


def lambda_handler(event, context):
    is_admin, admin_user, admin_user_id = _admin_identity(event)
    if not is_admin:
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}
    if not SECRET_KEY:
        return {'status': False, 'statusCode': 500,
                'description': 'El servicio no está configurado (SECRET_KEY).', 'data': {}}

    payload = _get_payload(event)
    customer_id = str(payload.get('customerId', '') or '').strip()
    if not customer_id:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el customerId.', 'data': {}}

    try:
        c = table_customer.get_item(
            Key={'customerId': customer_id},
            ProjectionExpression='company, companyTin').get('Item')
        if not c:
            return {'status': False, 'statusCode': 404, 'description': 'El cliente no existe.', 'data': {}}
        company = c.get('company', '')
        company_tin = c.get('companyTin', '')

        # Sesión REAL (revocable por sid) marcada como impersonación → auditable y cerrable.
        session_id = str(uuid.uuid4())
        table_session.put_item(Item={
            'sessionId': session_id, 'userId': str(admin_user_id or admin_user or 'admin'),
            'ipAddress': 'impersonation', 'device': 'admin-support', 'numberAttemps': 1,
            'active': True, 'impersonation': True, 'impersonatedCustomerId': customer_id,
            'impersonatedBy': str(admin_user or ''),
            'date': datetime.now().strftime('%Y-%m-%d %H:%M:%S')})

        token = _make_token(customer_id, company, company_tin, admin_user, admin_user_id, session_id)
        _audit(admin_user, admin_user_id, company,
               'Inició una vista "como cliente" (solo lectura) de {}'.format(company))

        return {'status': True, 'statusCode': 200,
                'description': 'Sesión de impersonación creada (solo lectura)',
                'data': {'token': token, 'customer': company, 'customerId': customer_id,
                         'companyTin': str(company_tin) if company_tin != '' else '',
                         'expiresInMinutes': IMPERSONATION_TTL_MIN,
                         'impersonatedBy': admin_user}}
    except Exception as e:
        print('Error en Impersonate: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al crear la sesión de impersonación', 'data': {}}
