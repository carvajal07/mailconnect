'''
Lambda CLIENTE: INICIA una recarga de saldo con WOMPI (cobro PREPAGO, Fase 2).

Ruta: POST /Balance/Topup-init  (integración no-proxy, envelope estándar)
Request:  { amount (COP, entero >= MIN_TOPUP) }   (el tenant sale del context del Authorizer)
Respuesta: 200 { data: { reference, amountInCents, currency, publicKey,
                          signatureIntegrity, redirectUrl } } · 400 datos · 403 sin sesión

Qué hace:
  1. Genera una `reference` única para el pago.
  2. Crea un movimiento `pending` en el ledger `walletTransaction` (txId = reference) con
     el monto y el customerId → el webhook lo transiciona a `approved` y acredita.
  3. Firma la INTEGRIDAD del pago (SHA256 de reference+amountInCents+currency+secret), que
     el Widget/Checkout de Wompi valida para que el monto no se pueda alterar en el navegador.

⚠️ NUNCA se acredita el saldo aquí ni desde el redirect del navegador: el saldo SOLO se
acredita en el webhook firmado por Wompi (Api_V1_Wallet_Wompi-webhook).

Llaves Wompi por variable de entorno (pendiente moverlas a Secrets Manager):
  WOMPI_PUBLIC_KEY, WOMPI_INTEGRITY_SECRET, WOMPI_CURRENCY (default COP),
  WOMPI_REDIRECT_URL (opcional), MIN_TOPUP (default 20000).
'''
import os
import json
import time
import uuid
import hashlib
import boto3

table_wallet = boto3.resource('dynamodb').Table('walletTransaction')

CURRENCY = os.environ.get('WOMPI_CURRENCY', 'COP')
MIN_TOPUP = int(os.environ.get('MIN_TOPUP', '20000'))      # mínimo de recarga en COP
WOMPI_PUBLIC_KEY = os.environ.get('WOMPI_PUBLIC_KEY', '')
WOMPI_INTEGRITY_SECRET = os.environ.get('WOMPI_INTEGRITY_SECRET', '')
WOMPI_REDIRECT_URL = os.environ.get('WOMPI_REDIRECT_URL', '')


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


def _integrity_signature(reference, amount_in_cents, currency):
    """Firma de integridad de Wompi: SHA256 de la concatenación
    <reference><amount_in_cents><currency><integrity_secret> en hex."""
    raw = '{}{}{}{}'.format(reference, amount_in_cents, currency, WOMPI_INTEGRITY_SECRET)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def lambda_handler(event, context):
    auth = _authorizer(event)
    customer_id = str(auth.get('customerId', '') or '').strip()
    if not customer_id:
        return {'status': False, 'statusCode': 403,
                'description': 'Sesión sin identidad de cliente.', 'data': {}}

    if not WOMPI_INTEGRITY_SECRET or not WOMPI_PUBLIC_KEY:
        return {'status': False, 'statusCode': 500,
                'description': 'La pasarela de pagos no está configurada. Contacta al administrador.',
                'data': {}}

    payload = _get_payload(event)
    amount = _to_int(payload.get('amount'), 0)
    if amount < MIN_TOPUP:
        return {'status': False, 'statusCode': 400,
                'description': 'El monto mínimo de recarga es ${:,} COP.'.format(MIN_TOPUP).replace(',', '.'),
                'data': {}}

    amount_in_cents = amount * 100   # Wompi maneja el valor en centavos (COP × 100)
    reference = 'mc-{}'.format(uuid.uuid4().hex)
    signature = _integrity_signature(reference, amount_in_cents, CURRENCY)

    try:
        # Movimiento PENDING en el ledger (txId = reference). El webhook lo transiciona a
        # approved y acredita. attribute_not_exists evita pisar una reference existente.
        table_wallet.put_item(
            Item={
                'txId': reference,
                'customerId': customer_id,
                'type': 'topup_wompi',
                'amount': amount,                 # COP
                'amountInCents': amount_in_cents,
                'balanceAfter': 0,                # se llena al acreditar
                'currency': CURRENCY,
                'status': 'pending',
                'actor': customer_id,
                'reference': reference,
                'detail': 'Recarga Wompi iniciada por ${:,} COP'.format(amount).replace(',', '.'),
                'createdAt': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime()),
            },
            ConditionExpression='attribute_not_exists(txId)',
        )
    except Exception as e:
        print('No se pudo crear el intento de recarga: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'No se pudo iniciar la recarga. Intenta de nuevo.', 'data': {}}

    return {'status': True, 'statusCode': 200,
            'description': 'Recarga iniciada',
            'data': {
                'reference': reference,
                'amountInCents': amount_in_cents,
                'currency': CURRENCY,
                'publicKey': WOMPI_PUBLIC_KEY,
                'signatureIntegrity': signature,
                'redirectUrl': WOMPI_REDIRECT_URL,
            }}
