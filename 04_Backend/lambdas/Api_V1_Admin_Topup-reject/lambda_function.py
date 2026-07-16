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


def _is_admin(event):
    return str(_authorizer(event).get('role', '')).lower() == 'admin'


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
            table_wallet.update_item(
                Key={'txId': tx_id},
                UpdateExpression='SET #s = :declined, rejectReason = :r, reviewedBy = :rev, reviewedAt = :now',
                ConditionExpression='#s = :pending',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={
                    ':declined': 'declined', ':pending': 'pending',
                    ':r': reason, ':rev': reviewer, ':now': _now()})
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
