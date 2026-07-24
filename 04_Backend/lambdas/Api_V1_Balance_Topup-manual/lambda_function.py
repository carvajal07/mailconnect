'''
Lambda ADMIN: AJUSTE / crédito DIRECTO de saldo (monedero PREPAGO) de un cliente.

Ruta: POST /Balance/Topup-manual  (integración no-proxy, envelope estándar)
Request:  { customerId, amount (COP, entero > 0), note? }
Respuesta: 200 ok · 400 datos inválidos · 403 no admin

Acredita el saldo del cliente de forma ATÓMICA (UpdateItem con ADD, sin leer-modificar-
escribir) y deja SIEMPRE un movimiento en el ledger `walletTransaction` (tipo `adjustment`).
Es un ajuste DIRECTO del admin (correcciones, cortesías, saldo inicial), DISTINTO de la
"recarga manual" del cliente (comprobante + aprobación), que usa el flujo Topup-manual-request
→ Admin_Topup-approve (tipo `topup_manual`). No requiere solicitud previa del cliente.

Tablas:
  - customerBalance  (PK customerId): saldo actual en COP.
  - walletTransaction (PK txId)      : ledger de todo movimiento de dinero.

⚠️ Endpoint administrativo: la lambda valida rol admin (context del Authorizer). En el
despliegue, además, restringir la ruta a admin (mapping template de `role`).
'''
import json
import time
import uuid
import boto3
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
table_balance = dynamodb.Table('customerBalance')
table_wallet = dynamodb.Table('walletTransaction')
_audit_table = dynamodb.Table('adminAudit')

CURRENCY = 'COP'


def _get_payload(event):
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


def _to_int(value, default=0):
    if isinstance(value, Decimal):
        return int(value)
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _audit(event, action, target='', detail=''):
    """Bitácora admin (best-effort; nunca rompe la operación)."""
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
    customer_id = str(payload.get('customerId', '') or '').strip()
    amount = _to_int(payload.get('amount'), 0)
    note = str(payload.get('note', '') or '').strip()

    if not customer_id:
        return {'status': False, 'statusCode': 400,
                'description': 'Indica el customerId del cliente.', 'data': {}}
    if amount <= 0:
        return {'status': False, 'statusCode': 400,
                'description': 'El monto a recargar debe ser un entero mayor a 0 (COP).', 'data': {}}

    actor = str(_authorizer(event).get('user') or _authorizer(event).get('userId') or 'admin')

    try:
        # Crédito ATÓMICO: crea el ítem si no existía (if_not_exists) y suma el monto.
        resp = table_balance.update_item(
            Key={'customerId': customer_id},
            UpdateExpression='SET balance = if_not_exists(balance, :z) + :amt, '
                             'currency = :cur, updatedAt = :now',
            ExpressionAttributeValues={':amt': amount, ':z': 0, ':cur': CURRENCY, ':now': _now()},
            ReturnValues='UPDATED_NEW',
        )
        new_balance = _to_int(resp['Attributes'].get('balance'), amount)

        # Ledger AUDITABLE: siempre se registra el movimiento (crédito positivo). Tipo
        # 'adjustment' = ajuste/crédito DIRECTO del admin (distinto de la recarga manual
        # del cliente, que pasa por comprobante + aprobación con tipo 'topup_manual').
        tx_id = str(uuid.uuid4())
        table_wallet.put_item(Item={
            'txId': tx_id,
            'customerId': customer_id,
            'type': 'adjustment',
            'amount': amount,               # positivo = crédito
            'balanceAfter': new_balance,
            'currency': CURRENCY,
            'status': 'approved',
            'actor': actor,
            'reference': '',
            'detail': note or 'Ajuste de saldo (admin)',
            'createdAt': _now(),
        })

        _audit(event, 'balance.adjustment', customer_id,
               'Ajuste de saldo de ${:,} COP al cliente {} (saldo: ${:,})'.format(
                   amount, customer_id, new_balance).replace(',', '.'))

        return {'status': True, 'statusCode': 200,
                'description': 'Ajuste de saldo aplicado.',
                'data': {'customerId': customer_id, 'amount': amount,
                         'balance': new_balance, 'currency': CURRENCY, 'txId': tx_id}}
    except Exception as e:
        print('Error en recarga manual: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al aplicar la recarga.', 'data': {}}
