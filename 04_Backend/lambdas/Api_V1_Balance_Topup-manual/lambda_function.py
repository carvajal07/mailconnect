'''
Lambda ADMIN: RECARGA MANUAL del saldo (monedero PREPAGO) de un cliente.

Ruta: POST /Balance/Topup-manual  (integración no-proxy, envelope estándar)
Request:  { customerId, amount (COP, entero > 0), note? }
Respuesta: 200 ok · 400 datos inválidos · 403 no admin

Acredita el saldo del cliente de forma ATÓMICA (UpdateItem con ADD, sin leer-modificar-
escribir) y deja SIEMPRE un movimiento en el ledger `walletTransaction` (auditable). La
usa el admin para cargar saldo por transferencia/efectivo (fuera de Wompi).

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


def _is_admin(event):
    return str(_authorizer(event).get('role', '')).lower() == 'admin'


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

        # Ledger AUDITABLE: siempre se registra el movimiento (crédito positivo).
        tx_id = str(uuid.uuid4())
        table_wallet.put_item(Item={
            'txId': tx_id,
            'customerId': customer_id,
            'type': 'topup_manual',
            'amount': amount,               # positivo = crédito
            'balanceAfter': new_balance,
            'currency': CURRENCY,
            'status': 'approved',
            'actor': actor,
            'reference': '',
            'detail': note or 'Recarga manual (admin)',
            'date': _now(),
        })

        _audit(event, 'balance.topup_manual', customer_id,
               'Recarga manual de ${:,} COP al cliente {} (saldo: ${:,})'.format(
                   amount, customer_id, new_balance).replace(',', '.'))

        return {'status': True, 'statusCode': 200,
                'description': 'Recarga aplicada.',
                'data': {'customerId': customer_id, 'amount': amount,
                         'balance': new_balance, 'currency': CURRENCY, 'txId': tx_id}}
    except Exception as e:
        print('Error en recarga manual: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al aplicar la recarga.', 'data': {}}
