'''
Lambda ADMIN: cambiar el SUB-ROL de empresa (tenantRole) de un usuario de un cliente,
entre owner | approver | operator (RBAC del portal; ver PLAN_APROBACIONES.md).

Ruta: POST /User/SetTenantRole  (no-proxy, envelope estándar)
Request:  { userId, tenantRole }   tenantRole ∈ owner | approver | operator
Respuesta: 200 ok · 400 datos inválidos · 403 no admin · 404 usuario no existe
           · 409 si dejaría a la empresa sin ningún owner

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue. Al degradar el
último owner de una empresa se bloquea (para que siempre quede quién gestione el saldo).
'''
import json
import time
import uuid
import boto3
from boto3.dynamodb.conditions import Attr

dynamodb = boto3.resource('dynamodb')
table_user = dynamodb.Table('user')
_audit_table = dynamodb.Table('adminAudit')

VALID_ROLES = ('owner', 'approver', 'operator')


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

def _count_owners(customer_id):
    """Cuántos usuarios de la empresa tienen tenantRole=owner (para no dejarla sin owner)."""
    count = 0
    kwargs = {'FilterExpression': Attr('customerId').eq(customer_id) & Attr('tenantRole').eq('owner'),
              'ProjectionExpression': 'userId'}
    while True:
        resp = table_user.scan(**kwargs)
        count += len(resp.get('Items', []))
        last = resp.get('LastEvaluatedKey')
        if not last:
            break
        kwargs['ExclusiveStartKey'] = last
    return count


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403, 'description': 'Acceso restringido a administradores.'}

    payload = _get_payload(event)
    user_id = payload.get('userId')
    tenant_role = str(payload.get('tenantRole', '')).lower().strip()

    if not user_id or tenant_role not in VALID_ROLES:
        return {'status': False, 'statusCode': 400,
                'description': 'Indica userId y tenantRole (owner | approver | operator).'}

    try:
        current = table_user.get_item(Key={'userId': user_id}).get('Item')
        if not current:
            return {'status': False, 'statusCode': 404, 'description': 'El usuario no existe.'}

        current_role = str(current.get('tenantRole', 'owner') or 'owner').lower()
        customer_id = current.get('customerId')
        if current_role == tenant_role:
            return {'status': True, 'statusCode': 200,
                    'description': f'El usuario ya es {tenant_role}.',
                    'data': {'userId': user_id, 'tenantRole': tenant_role}}

        # Degradar el último owner dejaría a la empresa sin quién gestione el saldo/todo.
        if current_role == 'owner' and tenant_role != 'owner' and customer_id and _count_owners(customer_id) <= 1:
            return {'status': False, 'statusCode': 409,
                    'description': 'No puedes degradar al último owner de la empresa.'}

        table_user.update_item(
            Key={'userId': user_id},
            UpdateExpression='SET tenantRole = :r',
            ExpressionAttributeValues={':r': tenant_role},
        )
        who = current.get('email') or current.get('name') or user_id
        _audit(event, 'user.tenantRole', who, f'Sub-rol de {who}: {current_role} → {tenant_role}')
        return {'status': True, 'statusCode': 200,
                'description': f'Sub-rol actualizado a {tenant_role}.',
                'data': {'userId': user_id, 'tenantRole': tenant_role}}
    except Exception as e:
        print('Error cambiando tenantRole: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al cambiar el sub-rol'}
