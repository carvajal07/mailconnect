'''
Lambda CLIENTE: crea una SOLICITUD de recarga MANUAL con comprobante (cobro PREPAGO).

Ruta: POST /Balance/Topup-manual-request  (integración no-proxy, envelope estándar)
Request:  { amount (COP entero > 0), proofS3Path (key del comprobante ya subido a S3),
            bank?, reference?, note? }   (el tenant sale del context del Authorizer)
Respuesta: 201 { data:{ txId, status } } · 400 datos · 403 sin sesión

Flujo: el cliente consigna/transfiere por fuera del sistema, sube el comprobante a S3 con
la URL prefirmada (get-urlS3, documentType=document) y ACÁ registra la solicitud como un
movimiento `pending` en `walletTransaction` (type='topup_manual'). **NO toca el saldo**: el
admin la aprueba/rechaza después (Admin_Topup-approve / -reject). Se guarda el bucket+key del
comprobante (derivados del NIT del cliente) para que el admin lo vea con una URL prefirmada.
'''
import os
import re
import json
import time
import uuid
import boto3

dynamodb = boto3.resource('dynamodb')
table_wallet = dynamodb.Table('walletTransaction')
table_customer = dynamodb.Table('customer')

BUCKET_PREFIX = os.environ.get('BUCKET_PREFIX', 'mailconnect')
CURRENCY = 'COP'


def tenant_bucket(nit, doc_type):
    clean = re.sub(r'[^a-z0-9]', '', str(nit or '').lower())
    return '{}-{}-{}'.format(BUCKET_PREFIX, clean, doc_type)


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
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _now():
    return time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())


def _customer_nit(customer_id):
    """NIT (companyTin) del cliente → define el bucket del comprobante."""
    try:
        item = table_customer.get_item(Key={'customerId': customer_id}).get('Item')
        return item.get('companyTin') if item else None
    except Exception as e:
        print('No se pudo leer el NIT del cliente: {}'.format(e))
        return None


def lambda_handler(event, context):
    auth = _authorizer(event)
    customer_id = str(auth.get('customerId', '') or '').strip()
    if not customer_id:
        return {'status': False, 'statusCode': 403,
                'description': 'Sesión sin identidad de cliente.', 'data': {}}

    payload = _get_payload(event)
    amount = _to_int(payload.get('amount'), 0)
    proof = str(payload.get('proofS3Path', '') or '').strip()

    if amount <= 0:
        return {'status': False, 'statusCode': 400,
                'description': 'Indica un monto a recargar mayor a 0 (COP).', 'data': {}}
    if not proof:
        return {'status': False, 'statusCode': 400,
                'description': 'Adjunta el comprobante de la transferencia.', 'data': {}}

    nit = _customer_nit(customer_id)
    proof_bucket = tenant_bucket(nit, 'document') if nit else ''
    actor = str(auth.get('user') or auth.get('userId') or customer_id)
    note = str(payload.get('note', '') or '').strip()

    tx_id = str(uuid.uuid4())
    try:
        table_wallet.put_item(Item={
            'txId': tx_id,
            'customerId': customer_id,
            'type': 'topup_manual',
            'status': 'pending',           # el saldo NO se toca hasta que el admin apruebe
            'amount': amount,
            'balanceAfter': 0,             # se llena al aprobar
            'currency': CURRENCY,
            'bank': str(payload.get('bank', '') or ''),
            'reference': str(payload.get('reference', '') or ''),
            'proofS3Path': proof,
            'proofBucket': proof_bucket,
            'actor': actor,
            'detail': note or 'Recarga manual (transferencia) — pendiente de aprobación',
            'createdAt': _now(),
        })
    except Exception as e:
        print('No se pudo crear la solicitud de recarga: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'No se pudo registrar la solicitud. Intenta de nuevo.', 'data': {}}

    return {'status': True, 'statusCode': 201,
            'description': 'Solicitud de recarga registrada. Un administrador la revisará.',
            'data': {'txId': tx_id, 'status': 'pending', 'amount': amount}}
