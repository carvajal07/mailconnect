"""
Pruebas de la recarga WOMPI (cobro PREPAGO, Fase 2) con moto:

  - Topup-init: crea el intento `pending` + firma de integridad; valida mínimo y sesión.
  - Webhook: verifica la firma del evento y acredita idempotente por `reference`
    (pending→approved), con casos firma válida / inválida / repetido / declined /
    monto que no coincide.

Las llaves Wompi se pasan por env ANTES de cargar las lambdas (las leen en import).
"""
import os
import sys
import json
import hashlib
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')
# Llaves Wompi de prueba (las lambdas las leen en import).
os.environ['WOMPI_PUBLIC_KEY'] = 'pub_test_123'
os.environ['WOMPI_INTEGRITY_SECRET'] = 'integ_secret'
os.environ['WOMPI_EVENTS_SECRET'] = 'events_secret'
os.environ['WOMPI_CURRENCY'] = 'COP'
os.environ['MIN_TOPUP'] = '20000'

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
LAMBDAS = REPO_ROOT / '04_Backend' / 'lambdas'
EVENTS_SECRET = 'events_secret'
INTEGRITY_SECRET = 'integ_secret'


def _load(module_name, folder):
    spec = importlib.util.spec_from_file_location(module_name, str(LAMBDAS / folder / 'lambda_function.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _res():
    return boto3.resource('dynamodb', region_name='us-east-1')


def _mk_table(ddb, name, keys):
    ddb.create_table(
        TableName=name,
        KeySchema=[{'AttributeName': k, 'KeyType': t} for k, t in keys],
        AttributeDefinitions=[{'AttributeName': k, 'AttributeType': 'S'} for k, _ in keys],
        BillingMode='PAY_PER_REQUEST')


def _balance(customer_id):
    item = _res().Table('customerBalance').get_item(Key={'customerId': customer_id}).get('Item')
    return int(item['balance']) if item else None


def _tx(reference):
    return _res().Table('walletTransaction').get_item(Key={'txId': reference}).get('Item')


@pytest.fixture
def wompi():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        _mk_table(ddb, 'walletTransaction', [('txId', 'HASH')])
        _mk_table(ddb, 'customerBalance', [('customerId', 'HASH')])
        yield {
            'init': _load('wompi_init_mod', 'Api_V1_Balance_Topup-init'),
            'hook': _load('wompi_hook_mod', 'Api_V1_Wallet_Wompi-webhook'),
        }


def _client_event(body):
    return {'body': body, 'requestContext': {'authorizer': {'customerId': 'CU1', 'customer': 'empresa'}}}


def _put_pending(reference='mc-ref-1', customer_id='CU1', amount=50000):
    _res().Table('walletTransaction').put_item(Item={
        'txId': reference, 'customerId': customer_id, 'type': 'topup_wompi',
        'amount': amount, 'amountInCents': amount * 100, 'balanceAfter': 0,
        'currency': 'COP', 'status': 'pending', 'reference': reference, 'date': '2026-01-01'})


def _sign_event(data, timestamp, secret, properties):
    parts = []
    for path in properties:
        val = data
        for key in path.split('.'):
            val = val[key]
        parts.append(str(val))
    raw = ''.join(parts) + str(timestamp) + secret
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def _webhook_event(reference, status, amount_cents, secret=EVENTS_SECRET, wompi_id='wompi-1', timestamp=1530291411):
    data = {'transaction': {
        'id': wompi_id, 'status': status, 'amount_in_cents': amount_cents,
        'reference': reference, 'currency': 'COP'}}
    props = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents']
    checksum = _sign_event(data, timestamp, secret, props)
    return {'body': json.dumps({
        'event': 'transaction.updated', 'data': data, 'timestamp': timestamp,
        'signature': {'properties': props, 'checksum': checksum}, 'environment': 'test'})}


# --------------------------------------------------------------------------- #
# Topup-init                                                                   #
# --------------------------------------------------------------------------- #
def test_topup_init_crea_intento_y_firma(wompi):
    init = wompi['init']
    resp = init.lambda_handler(_client_event({'amount': 50000}), None)
    assert resp['statusCode'] == 200
    data = resp['data']
    assert data['amountInCents'] == 5000000
    assert data['currency'] == 'COP' and data['publicKey'] == 'pub_test_123'
    # La firma de integridad coincide con la fórmula reference+amountInCents+currency+secret.
    expected = hashlib.sha256('{}{}{}{}'.format(
        data['reference'], 5000000, 'COP', INTEGRITY_SECRET).encode()).hexdigest()
    assert data['signatureIntegrity'] == expected
    # Quedó un intento pending en el ledger con ese reference.
    tx = _tx(data['reference'])
    assert tx['status'] == 'pending' and int(tx['amount']) == 50000 and tx['customerId'] == 'CU1'


def test_topup_init_valida_minimo_y_sesion(wompi):
    init = wompi['init']
    # Monto < mínimo (20000) → 400.
    assert init.lambda_handler(_client_event({'amount': 5000}), None)['statusCode'] == 400
    # Sin sesión → 403.
    assert init.lambda_handler({'body': {'amount': 50000}, 'requestContext': {'authorizer': {}}}, None)['statusCode'] == 403


# --------------------------------------------------------------------------- #
# Webhook                                                                      #
# --------------------------------------------------------------------------- #
def test_webhook_aprobado_acredita(wompi):
    hook = wompi['hook']
    _put_pending('mc-ref-1', 'CU1', 50000)
    resp = hook.lambda_handler(_webhook_event('mc-ref-1', 'APPROVED', 5000000), None)
    assert resp['statusCode'] == 200
    assert json.loads(resp['body'])['result'] == 'credited'
    assert _balance('CU1') == 50000
    tx = _tx('mc-ref-1')
    assert tx['status'] == 'approved' and int(tx['balanceAfter']) == 50000
    assert tx['wompiId'] == 'wompi-1'


def test_webhook_firma_invalida_no_acredita(wompi):
    hook = wompi['hook']
    _put_pending('mc-ref-1', 'CU1', 50000)
    # Firma calculada con un secreto equivocado → rechazo.
    ev = _webhook_event('mc-ref-1', 'APPROVED', 5000000, secret='otro_secreto')
    resp = hook.lambda_handler(ev, None)
    assert resp['statusCode'] == 401
    assert _balance('CU1') is None                 # sin acreditar
    assert _tx('mc-ref-1')['status'] == 'pending'  # intacto


def test_webhook_repetido_idempotente(wompi):
    hook = wompi['hook']
    _put_pending('mc-ref-1', 'CU1', 50000)
    ev = _webhook_event('mc-ref-1', 'APPROVED', 5000000)
    r1 = hook.lambda_handler(ev, None)
    r2 = hook.lambda_handler(ev, None)   # misma entrega otra vez
    assert json.loads(r1['body'])['result'] == 'credited'
    assert json.loads(r2['body'])['result'] == 'already'
    # Solo se acreditó UNA vez (no doble).
    assert _balance('CU1') == 50000


def test_webhook_declined_no_acredita(wompi):
    hook = wompi['hook']
    _put_pending('mc-ref-1', 'CU1', 50000)
    resp = hook.lambda_handler(_webhook_event('mc-ref-1', 'DECLINED', 5000000), None)
    assert resp['statusCode'] == 200
    assert json.loads(resp['body'])['result'] == 'not_approved'
    assert _balance('CU1') is None
    assert _tx('mc-ref-1')['status'] == 'declined'


def test_webhook_monto_no_coincide_no_acredita(wompi):
    hook = wompi['hook']
    _put_pending('mc-ref-1', 'CU1', 50000)   # intento por 5.000.000 centavos
    # El evento dice 9.900.000 centavos → no coincide → no acredita.
    resp = hook.lambda_handler(_webhook_event('mc-ref-1', 'APPROVED', 9900000), None)
    assert json.loads(resp['body'])['result'] == 'amount_mismatch'
    assert _balance('CU1') is None
    assert _tx('mc-ref-1')['status'] == 'pending'


def test_webhook_reference_inexistente(wompi):
    hook = wompi['hook']
    resp = hook.lambda_handler(_webhook_event('mc-no-existe', 'APPROVED', 5000000), None)
    assert resp['statusCode'] == 200
    assert json.loads(resp['body'])['result'] == 'missing'


def test_end_to_end_init_luego_webhook(wompi):
    # Flujo completo: Topup-init crea el intento; el webhook (con el reference real) acredita.
    init, hook = wompi['init'], wompi['hook']
    data = init.lambda_handler(_client_event({'amount': 100000}), None)['data']
    reference = data['reference']
    resp = hook.lambda_handler(_webhook_event(reference, 'APPROVED', data['amountInCents']), None)
    assert json.loads(resp['body'])['result'] == 'credited'
    assert _balance('CU1') == 100000
