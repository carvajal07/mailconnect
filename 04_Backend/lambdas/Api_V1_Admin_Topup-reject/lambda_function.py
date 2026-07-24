'''
Lambda ADMIN: RECHAZA una solicitud de recarga manual (cobro PREPAGO). No toca el saldo.

Ruta: POST /Admin/Topup-reject  (integración no-proxy, envelope estándar)
Request:  { txId, reason }
Respuesta: 200 ok (idempotente si ya estaba rechazada) · 400 · 403 · 404 · 409

Transición condicional `pending → declined` con el motivo. NO modifica el saldo. Un
reintento sobre una solicitud ya rechazada es idempotente; sobre una ya aprobada devuelve
409 (no se puede rechazar lo ya acreditado). Audita `balance.topup.reject`.
'''
import json
import time
import uuid
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_wallet = dynamodb.Table('walletTransaction')
_audit_table = dynamodb.Table('adminAudit')


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


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

def _now():
    return time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())


def _audit(event, action, target='', detail=''):
    try:
        auth = _authorizer(event)
        _audit_table.put_item(Item={
            'auditId': str(uuid.uuid4()),
            'action': action,
            'actor': str(auth.get('user') or auth.get('userId') or 'admin'),
            'actorId': str(auth.get('userId') or ''),
            'customer': str(auth.get('customer') or ''),
            'target': str(target),
            'detail': str(detail),
            'date': _now(),
        })
    except Exception as e:
        print('No se pudo registrar auditoría: {}'.format(e))


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}

    payload = _get_payload(event)
    tx_id = str(payload.get('txId', '') or '').strip()
    reason = str(payload.get('reason', '') or '').strip()
    if not tx_id:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el txId de la solicitud.', 'data': {}}
    if not reason:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el motivo del rechazo.', 'data': {}}

    reviewer = str(_authorizer(event).get('user') or _authorizer(event).get('userId') or 'admin')
    try:
        item = table_wallet.get_item(Key={'txId': tx_id}).get('Item')
        if not item or item.get('type') != 'topup_manual':
            return {'status': False, 'statusCode': 404, 'description': 'La solicitud no existe.', 'data': {}}
        status = item.get('status')
        if status == 'declined':
            return {'status': True, 'statusCode': 200, 'description': 'La solicitud ya estaba rechazada.',
                    'data': {'txId': tx_id, 'status': 'declined'}}
        if status != 'pending':
            return {'status': False, 'statusCode': 409,
                    'description': 'La solicitud no está pendiente (estado: {}).'.format(status), 'data': {}}

        try:
            # También se actualiza `detail` con el motivo, para que la columna "Detalle" del
            # ledger muestre el rechazo (y el porqué) al cliente, no "pendiente de aprobación".
            detail = 'Rechazada: {}'.format(reason)[:280]
            table_wallet.update_item(
                Key={'txId': tx_id},
                UpdateExpression='SET #s = :declined, rejectReason = :r, reviewedBy = :rev, reviewedAt = :now, #d = :det',
                ConditionExpression='#s = :pending',
                ExpressionAttributeNames={'#s': 'status', '#d': 'detail'},
                ExpressionAttributeValues={
                    ':declined': 'declined', ':pending': 'pending',
                    ':r': reason, ':rev': reviewer, ':now': _now(), ':det': detail})
        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                # Otra acción cambió el estado en paralelo: idempotente/limpio.
                return {'status': True, 'statusCode': 200, 'description': 'La solicitud ya no estaba pendiente.',
                        'data': {'txId': tx_id, 'status': 'declined'}}
            raise

        _audit(event, 'balance.topup.reject', item.get('customerId', ''),
               'Rechazó recarga manual de ${:,} COP. Motivo: {}'.format(
                   int(item.get('amount', 0)), reason).replace(',', '.'))
        return {'status': True, 'statusCode': 200, 'description': 'Solicitud rechazada.',
                'data': {'txId': tx_id, 'status': 'declined', 'reason': reason}}
    except Exception as e:
        print('Error rechazando la recarga: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al rechazar la recarga.', 'data': {}}
