'''
Lambda CLIENTE: consulta el SALDO (monedero PREPAGO) y el historial de movimientos.

Ruta: POST /Balance/Get  (integración no-proxy, envelope estándar)
Request:  { limit? }   (el tenant SIEMPRE sale del context del Authorizer, no del body)
Respuesta: 200 { data: { customerId, balance, currency, transactions:[{txId, type,
                          amount, balanceAfter, status, reference, bank, detail,
                          rejectReason, createdAt}], count } }

Multi-tenant OBLIGATORIO: el customerId sale del context del Authorizer; sin él → 403.
Un cliente solo ve SU saldo y SUS movimientos (incluye sus solicitudes de recarga manual
pendientes/aprobadas/rechazadas).

Tablas:
  - customerBalance   (PK customerId): saldo actual en COP (0 si nunca recargó).
  - walletTransaction (PK txId)       : ledger de movimientos. Se lee por el GSI
    `customerId-createdAt-index` (Query, orden por fecha desc). Si el índice aún no existe
    (rollout), cae a Scan+FilterExpression (correcto, solo más costoso).
'''
import json
import boto3
from decimal import Decimal
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table_balance = dynamodb.Table('customerBalance')
table_wallet = dynamodb.Table('walletTransaction')

CURRENCY = 'COP'
DEFAULT_LIMIT = 50
MAX_LIMIT = 200
GSI_NAME = 'customerId-createdAt-index'


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


def _to_int(value, default=0):
    if isinstance(value, Decimal):
        return int(value)
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _clean_tx(item):
    """Movimiento normalizado para el JSON del front (Decimal → int). Incluye el estado
    (pending/approved/declined) y el motivo de rechazo de las solicitudes manuales."""
    return {
        'txId': item.get('txId', ''),
        'type': item.get('type', ''),
        'amount': _to_int(item.get('amount'), 0),
        'balanceAfter': _to_int(item.get('balanceAfter'), 0),
        'currency': item.get('currency', CURRENCY),
        'status': item.get('status', ''),
        'reference': item.get('reference', ''),
        'bank': item.get('bank', ''),
        'detail': item.get('detail', ''),
        'rejectReason': item.get('rejectReason', ''),
        'createdAt': item.get('createdAt', ''),
    }


def _load_balance(customer_id):
    try:
        item = table_balance.get_item(Key={'customerId': customer_id}).get('Item')
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return 0
        raise
    return _to_int(item.get('balance'), 0) if item else 0


def _load_transactions(customer_id, limit):
    """Historial del cliente vía Query O(1) al GSI `customerId-createdAt-index` (orden por
    fecha desc). Escalable por defecto; si el GSI no existe, propaga el error (no Scan)."""
    resp = table_wallet.query(
        IndexName=GSI_NAME,
        KeyConditionExpression=Key('customerId').eq(customer_id),
        ScanIndexForward=False,   # más reciente primero
        Limit=limit)
    return [_clean_tx(i) for i in resp.get('Items', [])]


def lambda_handler(event, context):
    auth = _authorizer(event)
    customer_id = str(auth.get('customerId', '') or '').strip()

    # Multi-tenant OBLIGATORIO: sin identidad del token, se deniega.
    if not customer_id:
        return {'status': False, 'statusCode': 403,
                'description': 'Sesión sin identidad de cliente.',
                'data': {'balance': 0, 'currency': CURRENCY, 'transactions': [], 'count': 0}}

    payload = _get_payload(event)
    try:
        limit = max(1, min(MAX_LIMIT, int(payload.get('limit', DEFAULT_LIMIT))))
    except (TypeError, ValueError):
        limit = DEFAULT_LIMIT

    try:
        balance = _load_balance(customer_id)
        transactions = _load_transactions(customer_id, limit)
        return {'status': True, 'statusCode': 200,
                'description': 'Saldo del cliente',
                'data': {'customerId': customer_id, 'balance': balance, 'currency': CURRENCY,
                         'transactions': transactions, 'count': len(transactions)}}
    except Exception as e:
        print('Error consultando el saldo: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al consultar el saldo.',
                'data': {'balance': 0, 'currency': CURRENCY, 'transactions': [], 'count': 0}}
