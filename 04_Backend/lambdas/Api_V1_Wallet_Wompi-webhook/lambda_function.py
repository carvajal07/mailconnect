'''
Lambda PÚBLICA (proxy, SIN authorizer): WEBHOOK de eventos de WOMPI (cobro PREPAGO, Fase 2).

Ruta: POST /Wallet/Wompi-webhook  (integración Lambda-proxy, sin Authorizer, sin CORS)
Wompi envía aquí los eventos `transaction.updated`. Esta lambda:
  1. VERIFICA la firma del evento (checksum SHA256 con WOMPI_EVENTS_SECRET). Sin firma
     válida → 401 y NO se acredita nada.
  2. Si la transacción quedó APPROVED, acredita el saldo del cliente de forma IDEMPOTENTE:
     por la `reference` transiciona el movimiento del ledger `pending → approved` y suma el
     saldo en UNA operación atómica (TransactWriteItems). Una re-entrega del mismo evento
     falla la condición → no doble-acredita.
  3. Si la transacción NO fue aprobada (DECLINED/VOIDED/ERROR), marca el intento como tal
     (sin acreditar).

⚠️ El saldo SOLO se acredita aquí (evento firmado por Wompi), NUNCA desde el redirect del
navegador (que es manipulable). El monto se toma del intento `pending` creado por
Topup-init y se coteja con el del evento (defensa en profundidad).

Env: WOMPI_EVENTS_SECRET (obligatoria), WOMPI_CURRENCY (default COP).
'''
import os
import json
import time
import hmac
import hashlib
import boto3
from decimal import Decimal
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
ddb_client = boto3.client('dynamodb', region_name=REGION)
table_wallet = dynamodb.Table('walletTransaction')
table_balance = dynamodb.Table('customerBalance')

CURRENCY = os.environ.get('WOMPI_CURRENCY', 'COP')
WOMPI_EVENTS_SECRET = os.environ.get('WOMPI_EVENTS_SECRET', '')


def _now():
    return time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())


def _to_int(value, default=0):
    if isinstance(value, Decimal):
        return int(value)
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _proxy(status_code, body):
    return {'statusCode': status_code,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps(body)}


def _parse_event(event):
    """Body del proxy: string JSON (o dict si el mapping lo pasó como objeto)."""
    if isinstance(event, dict):
        body = event.get('body')
        if isinstance(body, str):
            try:
                return json.loads(body)
            except Exception:
                return {}
        if isinstance(body, dict):
            return body
    return event if isinstance(event, dict) else {}


def _event_checksum(event_json):
    """Checksum del evento Wompi: SHA256 de la concatenación de los valores de las
    `signature.properties` (en orden, tomados de `data`) + el timestamp + el EVENTS_SECRET."""
    sig = event_json.get('signature') or {}
    props = sig.get('properties') or []
    data = event_json.get('data') or {}
    parts = []
    for path in props:
        val = data
        for key in str(path).split('.'):
            val = val.get(key) if isinstance(val, dict) else None
        parts.append('' if val is None else str(val))
    timestamp = str(event_json.get('timestamp', ''))
    raw = ''.join(parts) + timestamp + WOMPI_EVENTS_SECRET
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def _verify_event(event_json):
    given = str((event_json.get('signature') or {}).get('checksum', ''))
    if not given or not WOMPI_EVENTS_SECRET:
        return False
    expected = _event_checksum(event_json)
    # Comparación en tiempo constante, sin sensibilidad a mayúsculas (Wompi usa hex mayús.).
    return hmac.compare_digest(expected.lower(), given.lower())


def _mark_status(reference, status):
    """Marca un intento `pending` como declined/voided/error (sin acreditar). Condicional a
    que siga `pending` (no pisa uno ya approved)."""
    try:
        table_wallet.update_item(
            Key={'txId': reference},
            UpdateExpression='SET #s = :st, updatedAt = :now',
            ConditionExpression='#s = :pending',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':st': status, ':pending': 'pending', ':now': _now()},
        )
    except ClientError as e:
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise


def _credit_approved(reference, wompi_id, amount_cents):
    """Acredita IDEMPOTENTE la recarga aprobada. Devuelve un código de resultado:
      'credited'       → se transicionó pending→approved y se sumó el saldo.
      'already'        → ya estaba approved (re-entrega): no se hace nada.
      'not_pending'    → el intento está en otro estado (p.ej. declined): no se acredita.
      'missing'        → no existe el intento para esa reference.
      'amount_mismatch'→ el monto del evento no coincide con el del intento: no se acredita.
    """
    item = table_wallet.get_item(Key={'txId': reference}).get('Item')
    if not item:
        return 'missing'
    status = item.get('status')
    if status == 'approved':
        return 'already'
    if status != 'pending':
        return 'not_pending'

    customer_id = item.get('customerId')
    amount = _to_int(item.get('amount'), 0)
    expected_cents = _to_int(item.get('amountInCents'), 0)
    if amount_cents and expected_cents and amount_cents != expected_cents:
        print('Monto del webhook ({}) != intento ({}) para {}'.format(amount_cents, expected_cents, reference))
        return 'amount_mismatch'
    if not customer_id or amount <= 0:
        return 'missing'

    now = _now()
    try:
        # Atómico: transiciona la txn (solo si pending) Y suma el saldo. Ambas o ninguna.
        ddb_client.transact_write_items(TransactItems=[
            {'Update': {
                'TableName': 'walletTransaction',
                'Key': {'txId': {'S': reference}},
                'UpdateExpression': 'SET #s = :approved, wompiId = :wid, approvedAt = :now',
                'ConditionExpression': '#s = :pending',
                'ExpressionAttributeNames': {'#s': 'status'},
                'ExpressionAttributeValues': {
                    ':approved': {'S': 'approved'}, ':pending': {'S': 'pending'},
                    ':wid': {'S': str(wompi_id or '')}, ':now': {'S': now}},
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
            # Otra entrega ganó la carrera (ya approved): idempotente.
            return 'already'
        raise

    # balanceAfter del movimiento (informativo, best-effort; el saldo real vive en customerBalance).
    try:
        bal = table_balance.get_item(Key={'customerId': customer_id}).get('Item') or {}
        table_wallet.update_item(
            Key={'txId': reference},
            UpdateExpression='SET balanceAfter = :b',
            ExpressionAttributeValues={':b': _to_int(bal.get('balance'), amount)})
    except Exception as e:
        print('No se pudo fijar balanceAfter del movimiento {}: {}'.format(reference, e))
    return 'credited'


def lambda_handler(event, context):
    event_json = _parse_event(event)

    # 1. Verificar la firma del evento. Sin firma válida → 401 (Wompi no reintenta).
    if not _verify_event(event_json):
        print('Webhook Wompi con firma inválida o EVENTS_SECRET sin configurar.')
        return _proxy(401, {'received': False, 'reason': 'invalid_signature'})

    txn = (event_json.get('data') or {}).get('transaction') or {}
    reference = str(txn.get('reference', '') or '')
    status = str(txn.get('status', '') or '').upper()
    wompi_id = txn.get('id')
    amount_cents = _to_int(txn.get('amount_in_cents'), 0)

    if not reference:
        return _proxy(200, {'received': True, 'result': 'no_reference'})

    try:
        if status == 'APPROVED':
            result = _credit_approved(reference, wompi_id, amount_cents)
        else:
            # DECLINED / VOIDED / ERROR: no se acredita; se marca el intento.
            _mark_status(reference, status.lower() or 'unknown')
            result = 'not_approved'
        print('Webhook {} status={} -> {}'.format(reference, status, result))
        return _proxy(200, {'received': True, 'reference': reference, 'result': result})
    except Exception as e:
        # Error transitorio nuestro: 500 para que Wompi REINTENTE (el crédito es idempotente).
        print('Error procesando webhook {}: {}'.format(reference, e))
        return _proxy(500, {'received': False, 'reference': reference})
