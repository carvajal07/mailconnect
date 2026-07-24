'''
Lambda ADMIN: ELIMINAR un cliente (empresa) + sus cuentas de usuario.

Borra el registro de `customer` y, best-effort, sus `user` y `userData` (para no dejar
logins huérfanos que sigan entrando con un JWT del cliente eliminado). NO purga el histórico
del cliente (campañas, procesos, `{tenant}_sendStatus`, buckets S3, saldo/ledger): esos datos
se conservan para trazabilidad/contabilidad. Si en el futuro se requiere un borrado total,
hágase como un proceso aparte y auditado.

Ruta: POST /Customer/Delete  (integración no-proxy, envelope estándar)
Request:  { customerId }
Respuesta: 200 data:{customerId, deletedUsers} · 400 (falta id / es tu propia empresa) ·
           403 (no admin) · 404 (no existe)

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue (Authorizer admin).
'''
import json
import time
import uuid
import boto3
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_customer = dynamodb.Table('customer')
table_user = dynamodb.Table('user')
table_userData = dynamodb.Table('userData')
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
        return {'status': False, 'statusCode': 403, 'description': 'Acceso restringido a administradores.'}

    payload = _get_payload(event)
    customer_id = payload.get('customerId')
    if not customer_id:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el customerId.'}

    # Guard: un admin no puede eliminar su PROPIA empresa (evita auto-bloqueo).
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    if str(auth.get('customerId') or '') == str(customer_id):
        return {'status': False, 'statusCode': 400,
                'description': 'No puedes eliminar tu propia empresa.'}

    try:
        current = table_customer.get_item(Key={'customerId': customer_id}).get('Item')
        if not current:
            return {'status': False, 'statusCode': 404, 'description': 'El cliente no existe.'}
        company = current.get('company') or customer_id

        # Borra las cuentas del cliente (best-effort): user + userData. Así el cliente
        # eliminado no puede seguir entrando con un JWT vigente.
        deleted_users = 0
        for u in _scan_all(table_user, FilterExpression=Attr('customerId').eq(customer_id),
                           ProjectionExpression='userId'):
            uid = u.get('userId')
            if not uid:
                continue
            try:
                table_user.delete_item(Key={'userId': uid})
                deleted_users += 1
            except Exception as e:
                print('No se pudo borrar el usuario {}: {}'.format(uid, e))
        for d in _scan_all(table_userData, FilterExpression=Attr('customerId').eq(customer_id),
                           ProjectionExpression='userDataId'):
            did = d.get('userDataId')
            if not did:
                continue
            try:
                table_userData.delete_item(Key={'userDataId': did})
            except Exception as e:
                print('No se pudo borrar el perfil {}: {}'.format(did, e))

        # Borra el cliente al final.
        table_customer.delete_item(Key={'customerId': customer_id})

        _audit(event, 'customer.delete', company,
               'Eliminó el cliente {} ({} cuenta(s) de usuario). No se purgó el histórico '
               '(campañas/envíos/saldo se conservan).'.format(company, deleted_users))
        return {'status': True, 'statusCode': 200,
                'description': 'Cliente eliminado.',
                'data': {'customerId': customer_id, 'deletedUsers': deleted_users}}
    except ClientError as e:
        print('Error eliminando cliente: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'No se pudo eliminar el cliente.'}
    except Exception as e:
        print('Error no controlado al eliminar cliente: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al eliminar el cliente.'}
