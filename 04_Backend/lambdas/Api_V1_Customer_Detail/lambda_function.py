'''
Lambda ADMIN: FICHA de un cliente (tabla `customer`) + sus usuarios.

Ruta: POST /Customer/Detail  (integración no-proxy, envelope estándar)
Request:  { customerId }
Respuesta: 200 { data: { customer:{customerId, company, companyTin,
                                   realSendEnabled, date},
                         users:[{userId, email, name, phone, role, tenantRole, active, date}],
                         count } }
           · 400 falta customerId · 404 no existe

Une `user` (por customerId) con `userData` (nombre/teléfono por userDataId).

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.
'''
import json
import boto3
from decimal import Decimal
from boto3.dynamodb.conditions import Attr

dynamodb = boto3.resource('dynamodb')
table_customer = dynamodb.Table('customer')
table_user = dynamodb.Table('user')
table_userData = dynamodb.Table('userData')


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

def _clean(value):
    return int(value) if isinstance(value, Decimal) else value


def _scan_all(table, **kwargs):
    items = []
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get('Items', []))
        last = resp.get('LastEvaluatedKey')
        if not last:
            break
        kwargs['ExclusiveStartKey'] = last
    return items


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}

    payload = _get_payload(event)
    customer_id = payload.get('customerId')
    if not customer_id:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el customerId.', 'data': {}}

    try:
        # customerId es la PK de customer: GetItem O(1) en vez de Scan O(tabla).
        c = table_customer.get_item(Key={'customerId': customer_id}).get('Item')
        if not c:
            return {'status': False, 'statusCode': 404, 'description': 'El cliente no existe.', 'data': {}}
        limits = c.get('sendingLimits') or {}
        customer = {
            'customerId': c.get('customerId'),
            'company': c.get('company', ''),
            'companyTin': c.get('companyTin', ''),
            'realSendEnabled': bool(c.get('realSendEnabled', True)),
            'sendingLimits': ({k: int(v or 0) for k, v in limits.items()}
                              if isinstance(limits, dict) else {}),
            'date': c.get('date', ''),
        }

        # Datos de perfil (nombre/teléfono) por userDataId.
        datas = _scan_all(table_userData, FilterExpression=Attr('customerId').eq(customer_id))
        by_data_id = {d.get('userDataId'): d for d in datas}

        users = []
        for u in _scan_all(table_user, FilterExpression=Attr('customerId').eq(customer_id)):
            profile = by_data_id.get(u.get('userDataId'), {})
            users.append({
                'userId': u.get('userId'),
                'email': u.get('email', ''),
                'name': profile.get('userName', ''),
                'phone': profile.get('phone', ''),
                'role': str(u.get('role', 'client')),
                # Sub-rol de empresa (RBAC): owner|approver|operator (default owner).
                'tenantRole': str(u.get('tenantRole', 'owner') or 'owner'),
                'active': bool(u.get('active', False)),
                'date': _clean(u.get('date', '')),
            })
        users.sort(key=lambda x: (x['role'] != 'admin', str(x['name']).lower()))

        return {
            'status': True, 'statusCode': 200,
            'description': 'Ficha del cliente',
            'data': {'customer': customer, 'users': users, 'count': len(users)}
        }
    except Exception as e:
        print('Error en ficha de cliente: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al obtener la ficha', 'data': {}}
