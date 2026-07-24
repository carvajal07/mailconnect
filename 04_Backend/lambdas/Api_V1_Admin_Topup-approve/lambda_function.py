'''
Lambda ADMIN: APRUEBA una solicitud de recarga manual → acredita el saldo (cobro PREPAGO).

Ruta: POST /Admin/Topup-approve  (integración no-proxy, envelope estándar)
Request:  { txId }
Respuesta: 200 ok (o idempotente si ya estaba aprobada) · 400 · 403 · 404 · 409

Acreditación ATÓMICA e IDEMPOTENTE: en un TransactWriteItems marca la solicitud
`pending → approved` (condición) Y suma el `amount` al saldo, en una sola operación. Un
doble clic / reintento choca con la condición y NO acredita dos veces. El monto sale de la
solicitud guardada (no del request), como control anti-fraude. Audita `balance.topup.approve`.
'''
import json
import time
import uuid
import boto3
from decimal import Decimal
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
ddb_client = boto3.client('dynamodb', region_name=REGION)
table_wallet = dynamodb.Table('walletTransaction')
table_balance = dynamodb.Table('customerBalance')
_audit_table = dynamodb.Table('adminAudit')

CURRENCY = 'COP'


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

def _to_int(value, default=0):
    if isinstance(value, Decimal):
        return int(value)
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


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
    if not tx_id:
        return {'status': False, 'statusCode': 400, 'description': 'Indica el txId de la solicitud.', 'data': {}}

    try:
        item = table_wallet.get_item(Key={'txId': tx_id}).get('Item')
        if not item or item.get('type') != 'topup_manual':
            return {'status': False, 'statusCode': 404, 'description': 'La solicitud no existe.', 'data': {}}
        status = item.get('status')
        if status == 'approved':
            # Idempotente: ya se acreditó (reintento / doble clic).
            return {'status': True, 'statusCode': 200, 'description': 'La solicitud ya estaba aprobada.',
                    'data': {'txId': tx_id, 'status': 'approved', 'alreadyApproved': True}}
        if status != 'pending':
            return {'status': False, 'statusCode': 409,
                    'description': 'La solicitud no está pendiente (estado: {}).'.format(status), 'data': {}}

        customer_id = item.get('customerId')
        amount = _to_int(item.get('amount'), 0)
        if not customer_id or amount <= 0:
            return {'status': False, 'statusCode': 400, 'description': 'Solicitud inválida.', 'data': {}}

        reviewer = str(_authorizer(event).get('user') or _authorizer(event).get('userId') or 'admin')
        now = _now()
        try:
            # Atómico: transición pending→approved (condición) + suma del saldo.
            ddb_client.transact_write_items(TransactItems=[
                {'Update': {
                    'TableName': 'walletTransaction',
                    'Key': {'txId': {'S': tx_id}},
                    # También se actualiza `detail` para que la columna "Detalle" del ledger
                    # deje de mostrar "pendiente de aprobación" tras aprobar.
                    'UpdateExpression': 'SET #s = :approved, reviewedBy = :rev, approvedAt = :now, #d = :det',
                    'ConditionExpression': '#s = :pending',
                    'ExpressionAttributeNames': {'#s': 'status', '#d': 'detail'},
                    'ExpressionAttributeValues': {
                        ':approved': {'S': 'approved'}, ':pending': {'S': 'pending'},
                        ':rev': {'S': reviewer}, ':now': {'S': now},
                        ':det': {'S': 'Recarga aprobada'}},
                }},
                {'Update': {
                    'TableName': 'customerBalance',
                    'Key': {'customerId': {'S': customer_id}},
                    'UpdateExpression': 'SET balance = if_not_exists(balance, :z) + :amt, currency = :cur, updatedAt = :now',
                    'ExpressionAttributeValues': {
                        ':amt': {'N': str(amount)}, ':z': {'N': '0'},
                        ':cur': {'S': CURRENCY}, ':now': {'S': now}},
                }},
            ])
        except ClientError as e:
            if e.response['Error']['Code'] in ('TransactionCanceledException', 'ConditionalCheckFailedException'):
                # Otra aprobación ganó la carrera: idempotente.
                return {'status': True, 'statusCode': 200, 'description': 'La solicitud ya estaba aprobada.',
                        'data': {'txId': tx_id, 'status': 'approved', 'alreadyApproved': True}}
            raise

        # balanceAfter del movimiento (informativo) + saldo nuevo para la respuesta.
        new_balance = amount
        try:
            bal = table_balance.get_item(Key={'customerId': customer_id}).get('Item') or {}
            new_balance = _to_int(bal.get('balance'), amount)
            table_wallet.update_item(
                Key={'txId': tx_id},
                UpdateExpression='SET balanceAfter = :b',
                ExpressionAttributeValues={':b': new_balance})
        except Exception as e:
            print('No se pudo fijar balanceAfter de {}: {}'.format(tx_id, e))

        _audit(event, 'balance.topup.approve', customer_id,
               'Aprobó recarga manual de ${:,} COP (saldo: ${:,})'.format(amount, new_balance).replace(',', '.'))
        return {'status': True, 'statusCode': 200, 'description': 'Recarga aprobada y saldo acreditado.',
                'data': {'txId': tx_id, 'status': 'approved', 'amount': amount, 'balance': new_balance}}
    except Exception as e:
        print('Error aprobando la recarga: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al aprobar la recarga.', 'data': {}}
