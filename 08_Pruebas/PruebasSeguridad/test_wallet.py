"""
Pruebas del COBRO PREPAGO (monedero) con moto (DynamoDB + S3 + SQS):

  - Débito atómico en el envío real (Prepare-batch): suficiente / insuficiente /
    concurrente (no sobregira) / idempotencia (AlreadySending no doble-cobra) /
    compensación (reembolso si el troceo falla tras debitar).
  - Recarga manual admin (Api_V1_Balance_Topup-manual).
  - Consulta de saldo cliente (Api_V1_Balance_Get) y admin (Api_V1_Admin_Balances).

`pandas` se stubea (viene por layer en AWS). El costo se calcula con la MISMA fórmula
que el estimador: EM con N destinatarios = max(8·N, 5000)·1.19. Para el CSV de 5 filas:
max(40, 5000)·1.19 = 5950 COP.
"""
import os
import sys
import json
import types
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402
from boto3.dynamodb.conditions import Attr  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
LAMBDAS = REPO_ROOT / '04_Backend' / 'lambdas'

# Costo esperado del envío real del CSV de prueba (5 filas, canal EM).
EXPECTED_COST = 5950

CSV_CONTENT = (
    "Id;Correo;Nombre\n"
    "1;ana@test.com;Ana\n"
    "2;luis@test.com;Luis\n"
    "3;eva@test.com;Eva\n"
    "4;malformado;Malo\n"
    "5;negro@test.com;Negro\n"
)


def _load(module_name, folder):
    if 'pandas' not in sys.modules:
        sys.modules['pandas'] = types.ModuleType('pandas')
    spec = importlib.util.spec_from_file_location(module_name, str(LAMBDAS / folder / 'lambda_function.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _mk_table(ddb, name, keys):
    ddb.create_table(
        TableName=name,
        KeySchema=[{'AttributeName': k, 'KeyType': t} for k, t in keys],
        AttributeDefinitions=[{'AttributeName': k, 'AttributeType': 'S'} for k, _ in keys],
        BillingMode='PAY_PER_REQUEST')


def _res():
    return boto3.resource('dynamodb', region_name='us-east-1')


def _set_balance(customer_id, amount):
    _res().Table('customerBalance').put_item(Item={
        'customerId': customer_id, 'balance': amount, 'currency': 'COP', 'updatedAt': '2026-01-01'})


def _get_balance(customer_id):
    item = _res().Table('customerBalance').get_item(Key={'customerId': customer_id}).get('Item')
    return int(item['balance']) if item else None


def _wallet_rows(customer_id=None):
    rows = _res().Table('walletTransaction').scan().get('Items', [])
    if customer_id:
        rows = [r for r in rows if r.get('customerId') == customer_id]
    return rows


# --------------------------------------------------------------------------- #
# Fixture de entorno completo (envío real con monedero)                        #
# --------------------------------------------------------------------------- #
@pytest.fixture
def env(monkeypatch):
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        res = _res()

        _mk_table(ddb, 'campaign', [('campaignId', 'HASH')])
        _mk_table(ddb, 'process', [('processId', 'HASH')])
        _mk_table(ddb, 'customer', [('customerId', 'HASH')])
        _mk_table(ddb, 'customerBalance', [('customerId', 'HASH')])
        _mk_table(ddb, 'walletTransaction', [('txId', 'HASH')])
        _mk_table(ddb, 'empresa_unsubscribe', [('email', 'HASH')])
        _mk_table(ddb, 'empresa_blackList', [('email', 'HASH')])

        res.Table('campaign').put_item(Item={
            'campaignId': 'C1', 'campaignName': 'Promo', 'customerId': 'CU1',
            'consecutive': 1, 'channel': 'EM', 'dataPath': 'bases/base.csv',
            'campaignState': 'Pendiente', 'originEmail': 'envios@empresa.com',
            'template': 'T', 'samplesSentCount': 0,
        })
        res.Table('customer').put_item(Item={
            'customerId': 'CU1', 'company': 'empresa', 'companyTin': '900123', 'realSendEnabled': True})
        res.Table('empresa_blackList').put_item(Item={'email': 'negro@test.com'})
        # Saldo por defecto: suficiente. Los tests que prueban insuficiencia lo bajan.
        _set_balance('CU1', 100000)

        s3 = boto3.client('s3', region_name='us-east-1')
        s3.create_bucket(Bucket='mailconnect-900123-database')
        s3.put_object(Bucket='mailconnect-900123-database', Key='bases/base.csv',
                      Body=CSV_CONTENT.encode('utf-8'))

        sqs = boto3.client('sqs', region_name='us-east-1')
        channel_url = sqs.create_queue(QueueName='Email_Send-batch-template-EM')['QueueUrl']
        part_url = sqs.create_queue(QueueName='Email_Prepare-batch-part')['QueueUrl']

        module = _load('pb_wallet_mod', 'Api_V1_Email_Prepare-batch-template')
        monkeypatch.setattr(module, 'URL_SQS_EM', channel_url)
        monkeypatch.setattr(module, 'URL_SQS_PREPARE_PART', part_url)
        monkeypatch.setattr(module, 'PART_SIZE', 2)
        yield module, channel_url, part_url


def _api_event(resource='/Email/Send-batch-template'):
    return {
        'resource': resource,
        'body': json.dumps({
            'customerName': 'empresa', 'campaignName': 'Promo', 'userId': 'U1',
            'template': 'T', 'templateVersion': 1,
        }),
    }


def _drain(sqs, url):
    bodies = []
    while True:
        msgs = sqs.receive_message(QueueUrl=url, MaxNumberOfMessages=10).get('Messages', [])
        if not msgs:
            break
        for m in msgs:
            bodies.append(json.loads(m['Body']))
            sqs.delete_message(QueueUrl=url, ReceiptHandle=m['ReceiptHandle'])
    return bodies


def _campaign():
    return _res().Table('campaign').get_item(Key={'campaignId': 'C1'})['Item']


# --------------------------------------------------------------------------- #
# Débito en el envío real                                                      #
# --------------------------------------------------------------------------- #
def test_debito_suficiente_cobra_y_procede(env):
    pb, channel_url, part_url = env
    resp = pb.lambda_handler(_api_event(), None)
    assert json.loads(resp['body'])['status_code'] == 200

    # La campaña arrancó el envío y se troceó.
    assert _campaign()['campaignState'] == 'Enviando'
    jobs = _drain(boto3.client('sqs', region_name='us-east-1'), part_url)
    assert len(jobs) == 3

    # Se debitó el costo exacto (max(8·5,5000)·1.19 = 5950).
    assert _get_balance('CU1') == 100000 - EXPECTED_COST

    # Ledger: 1 movimiento de débito, negativo, con reference = processId.
    debits = [r for r in _wallet_rows('CU1') if r.get('type') == 'debit']
    assert len(debits) == 1
    assert int(debits[0]['amount']) == -EXPECTED_COST
    assert int(debits[0]['balanceAfter']) == 100000 - EXPECTED_COST
    assert debits[0]['reference'] == _campaign()['sendProcessId']


def test_debito_insuficiente_bloquea_402(env):
    pb, channel_url, part_url = env
    _set_balance('CU1', 1000)  # < 5950
    resp = pb.lambda_handler(_api_event(), None)
    body = json.loads(resp['body'])

    # 402 (bloqueo duro por saldo), sin marcar Error.
    assert body['status'] is False and body['status_code'] == 402
    # El lock se liberó: la campaña vuelve a ser enviable (Pendiente), no 'Enviando'/'Error'.
    assert _campaign()['campaignState'] == 'Pendiente'
    # No se troceó nada (no se encoló ningún trabajo de parte).
    assert _drain(boto3.client('sqs', region_name='us-east-1'), part_url) == []
    # El saldo quedó INTACTO (no hubo débito parcial) y no hay movimientos.
    assert _get_balance('CU1') == 1000
    assert [r for r in _wallet_rows('CU1') if r.get('type') == 'debit'] == []


def test_reserve_balance_atomico_no_sobregira(env):
    # El débito condicional (balance >= costo) es lo que hace SEGURO el envío concurrente:
    # dos reservas de 6000 sobre un saldo de 10000 → la primera pasa, la segunda NO.
    pb, _c, _p = env
    _set_balance('CU1', 10000)
    st = pb.ProcessState()
    st.customer_id = 'CU1'
    st.process_id = 'PROC-1'
    st.formatted_date = '2026-01-01T00:00:00.000Z'

    assert pb.reserve_balance(st, 6000, 'Promo') == 4000
    with pytest.raises(pb.InsufficientBalance):
        pb.reserve_balance(st, 6000, 'Promo')
    # Solo se debitó una vez.
    assert _get_balance('CU1') == 4000
    debits = [r for r in _wallet_rows('CU1') if r.get('type') == 'debit']
    assert len(debits) == 1


def test_already_sending_no_doble_cobra(env, monkeypatch):
    # Reintento / envío concurrente que choca con el lock: NO debe volver a cobrar.
    pb, channel_url, part_url = env
    monkeypatch.setattr(pb, 'try_start_real_send', lambda st, pid: False)
    resp = pb.lambda_handler(_api_event(), None)
    body = json.loads(resp['body'])

    # Idempotencia: 200 limpio, sin re-encolar ni cobrar.
    assert body['status'] is True and body['status_code'] == 200
    assert _get_balance('CU1') == 100000  # intacto
    assert _wallet_rows('CU1') == []
    assert _drain(boto3.client('sqs', region_name='us-east-1'), part_url) == []


def test_compensacion_reembolsa_si_troceo_falla(env, monkeypatch):
    # Si el troceo/encolado falla DESPUÉS de debitar, se reembolsa (compensación).
    pb, channel_url, part_url = env

    def _boom(*a, **k):
        raise RuntimeError('SQS caído')
    monkeypatch.setattr(pb, 'enqueue_part_job', _boom)

    resp = pb.lambda_handler(_api_event(), None)
    body = json.loads(resp['body'])
    assert body['status'] is False and body['status_code'] == 400
    assert _campaign()['campaignState'] == 'Error'

    # El saldo se reembolsó por completo (débito + reembolso = neto 0).
    assert _get_balance('CU1') == 100000
    tipos = sorted(r.get('type') for r in _wallet_rows('CU1'))
    assert tipos == ['debit', 'refund']


def test_muestras_no_cobran(env):
    # El envío de MUESTRAS no debita saldo (solo el envío real cobra).
    pb, channel_url, part_url = env
    event = {
        'resource': '/Email/Send-batch-template-samples',
        'body': json.dumps({
            'customerName': 'empresa', 'campaignName': 'Promo', 'userId': 'U1',
            'template': 'T', 'templateVersion': 1,
            'quantitySamples': 1, 'selectiveSamples': False,
            'recipients': ['prueba@test.com'],
        }),
    }
    resp = pb.lambda_handler(event, None)
    body = json.loads(resp['body'])
    assert body['status'] is True
    assert _get_balance('CU1') == 100000  # intacto
    assert _wallet_rows('CU1') == []


# --------------------------------------------------------------------------- #
# Recarga manual (admin) + consultas de saldo                                  #
# --------------------------------------------------------------------------- #
@pytest.fixture
def wallet_env():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        res = _res()
        _mk_table(ddb, 'customerBalance', [('customerId', 'HASH')])
        _mk_table(ddb, 'walletTransaction', [('txId', 'HASH')])
        _mk_table(ddb, 'customer', [('customerId', 'HASH')])
        _mk_table(ddb, 'adminAudit', [('auditId', 'HASH')])
        res.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'empresa', 'companyTin': '900123'})
        res.Table('customer').put_item(Item={'customerId': 'CU2', 'company': 'otra', 'companyTin': '800555'})
        yield {
            'topup': _load('bal_topup_mod', 'Api_V1_Balance_Topup-manual'),
            'get': _load('bal_get_mod', 'Api_V1_Balance_Get'),
            'admin': _load('bal_admin_mod', 'Api_V1_Admin_Balances'),
        }


def _admin_event(body):
    return {'body': body, 'requestContext': {'authorizer': {'role': 'admin', 'user': 'boss', 'userId': 'A1'}}}


def _client_event(body, customer_id='CU1', customer='empresa'):
    return {'body': body, 'requestContext': {'authorizer': {'customerId': customer_id, 'customer': customer}}}


def test_topup_manual_acredita_y_registra(wallet_env):
    topup = wallet_env['topup']
    resp = topup.lambda_handler(_admin_event({'customerId': 'CU1', 'amount': 50000, 'note': 'transferencia'}), None)
    assert resp['statusCode'] == 200
    assert _get_balance('CU1') == 50000
    rows = _wallet_rows('CU1')
    assert len(rows) == 1
    assert rows[0]['type'] == 'topup_manual' and int(rows[0]['amount']) == 50000
    assert int(rows[0]['balanceAfter']) == 50000

    # Segunda recarga: suma sobre el saldo existente (crédito atómico).
    topup.lambda_handler(_admin_event({'customerId': 'CU1', 'amount': 20000}), None)
    assert _get_balance('CU1') == 70000


def test_topup_manual_valida_admin_y_monto(wallet_env):
    topup = wallet_env['topup']
    # No admin → 403.
    no_admin = {'body': {'customerId': 'CU1', 'amount': 1000}, 'requestContext': {'authorizer': {'role': 'client'}}}
    assert topup.lambda_handler(no_admin, None)['statusCode'] == 403
    # Monto <= 0 → 400.
    assert topup.lambda_handler(_admin_event({'customerId': 'CU1', 'amount': 0}), None)['statusCode'] == 400
    assert topup.lambda_handler(_admin_event({'customerId': 'CU1', 'amount': -5}), None)['statusCode'] == 400
    # Sin customerId → 400.
    assert topup.lambda_handler(_admin_event({'amount': 1000}), None)['statusCode'] == 400
    assert _get_balance('CU1') is None  # nada se acreditó


def test_balance_get_devuelve_saldo_y_movimientos(wallet_env):
    topup, get = wallet_env['topup'], wallet_env['get']
    topup.lambda_handler(_admin_event({'customerId': 'CU1', 'amount': 30000}), None)

    resp = get.lambda_handler(_client_event({}), None)
    assert resp['statusCode'] == 200
    assert resp['data']['balance'] == 30000
    assert resp['data']['currency'] == 'COP'
    assert len(resp['data']['transactions']) == 1
    # Un cliente sin identidad en el token → 403.
    assert get.lambda_handler({'body': {}, 'requestContext': {'authorizer': {}}}, None)['statusCode'] == 403
    # Aislamiento: CU2 no ve los movimientos de CU1.
    resp2 = get.lambda_handler(_client_event({}, customer_id='CU2', customer='otra'), None)
    assert resp2['data']['balance'] == 0 and resp2['data']['transactions'] == []


def test_admin_balances_lista_todos(wallet_env):
    topup, admin = wallet_env['topup'], wallet_env['admin']
    topup.lambda_handler(_admin_event({'customerId': 'CU1', 'amount': 30000}), None)

    resp = admin.lambda_handler(_admin_event({}), None)
    assert resp['statusCode'] == 200
    rows = {r['customerId']: r for r in resp['data']['customers']}
    assert rows['CU1']['balance'] == 30000
    assert rows['CU2']['balance'] == 0           # incluye clientes sin recarga
    assert resp['data']['totals']['balance'] == 30000
    # Orden: saldo más bajo primero (CU2=0 antes que CU1=30000).
    assert resp['data']['customers'][0]['customerId'] == 'CU2'
    # No admin → 403.
    no_admin = {'body': {}, 'requestContext': {'authorizer': {'role': 'client'}}}
    assert admin.lambda_handler(no_admin, None)['statusCode'] == 403
