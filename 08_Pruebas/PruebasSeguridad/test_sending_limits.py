"""
Pruebas de las CUOTAS de envío por cliente (Bloque E): customer.sendingLimits
(maxPerCampaign / maxPerDay) aplicadas por Prepare-batch en el envío real
(check_sending_limits → SendingLimitExceeded → 429), y su administración vía
Customer/Update (merge + auditoría) y Customer/List.
"""
import os
import sys
import types
import importlib.util
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402
from helpers_auth import make_token  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DIR = REPO_ROOT / '04_Backend' / 'lambdas'


def _load(folder, name):
    if 'pandas' not in sys.modules:   # viene por layer en AWS; aquí se stubea
        sys.modules['pandas'] = types.ModuleType('pandas')
    p = DIR / folder / 'lambda_function.py'
    spec = importlib.util.spec_from_file_location(name, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _pk(name, pk):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


def _today_iso(hour='10'):
    return datetime.now(timezone.utc).strftime('%Y-%m-%d') + 'T{}:00:00.000Z'.format(hour)


@pytest.fixture
def env():
    with mock_aws():
        _pk('customer', 'customerId')
        _pk('process', 'processId')
        _pk('adminAudit', 'auditId')
        yield _load('Api_V1_Email_Prepare-batch-template', 'pb_limits')


def _st(pb):
    st = pb.ProcessState()
    st.customer_id = 'CU1'
    st.customer_name = 'Acme'
    return st


def test_sin_limites_no_bloquea(env):
    boto3.resource('dynamodb', region_name='us-east-1').Table('customer').put_item(
        Item={'customerId': 'CU1', 'company': 'Acme'})
    env.check_sending_limits(_st(env), 1000000)   # no lanza


def test_tope_por_campana(env):
    boto3.resource('dynamodb', region_name='us-east-1').Table('customer').put_item(
        Item={'customerId': 'CU1', 'company': 'Acme',
              'sendingLimits': {'maxPerCampaign': 100, 'maxPerDay': 0}})
    env.check_sending_limits(_st(env), 100)       # exacto: pasa
    with pytest.raises(env.SendingLimitExceeded):
        env.check_sending_limits(_st(env), 101)


def test_tope_diario_suma_lo_despachado_hoy(env):
    ddb = boto3.resource('dynamodb', region_name='us-east-1')
    ddb.Table('customer').put_item(
        Item={'customerId': 'CU1', 'company': 'Acme',
              'sendingLimits': {'maxPerDay': 100}})
    # Hoy ya se despacharon 80 reales; una MUESTRA de hoy y un real de AYER no cuentan.
    ddb.Table('process').put_item(Item={
        'processId': 'P1', 'customerName': 'Acme', 'date': _today_iso(),
        'registersToSend': 80})
    ddb.Table('process').put_item(Item={
        'processId': 'PS', 'customerName': 'Acme', 'date': _today_iso('11'),
        'registersToSend': 500, 'isSamples': True})
    ddb.Table('process').put_item(Item={
        'processId': 'P0', 'customerName': 'Acme', 'date': '2020-01-01T10:00:00.000Z',
        'registersToSend': 500})
    # Otro cliente hoy tampoco cuenta.
    ddb.Table('process').put_item(Item={
        'processId': 'PX', 'customerName': 'Otra', 'date': _today_iso(),
        'registersToSend': 500})

    assert env.sent_today_count('Acme') == 80
    env.check_sending_limits(_st(env), 20)        # 80 + 20 = 100: pasa
    with pytest.raises(env.SendingLimitExceeded):
        env.check_sending_limits(_st(env), 21)    # 80 + 21 > 100


def test_lectura_de_limites_fail_open(env):
    # Cliente inexistente / error → sin tope (no bloquear por un GetItem caído).
    assert env.get_sending_limits('NO-EXISTE') == {'maxPerCampaign': 0, 'maxPerDay': 0}


# ───────────────────── Customer/Update + List (admin de cuotas) ─────────────────────

def _admin(payload=None):
    return {'body': None, 'authToken': make_token(),
            'requestContext': {'authorizer': {'role': 'admin', 'user': 'ana@acme.co'}},
            **(payload or {})}


@pytest.fixture
def adm():
    with mock_aws():
        _pk('customer', 'customerId')
        _pk('adminAudit', 'auditId')
        boto3.resource('dynamodb', region_name='us-east-1').Table('customer').put_item(
            Item={'customerId': 'CU1', 'company': 'Acme', 'realSendEnabled': True})
        yield {'update': _load('Api_V1_Customer_Update', 'cu_limits'),
               'list': _load('Api_V1_Customer_List', 'cl_limits'),
               'audit': _load('Api_V1_Admin_Audit', 'aud_limits')}


def test_update_guarda_y_mergea_limites(adm):
    r1 = adm['update'].lambda_handler(
        _admin({'customerId': 'CU1', 'limits': {'maxPerCampaign': 5000}}), None)
    assert r1['statusCode'] == 200 and r1['data']['sendingLimits'] == {'maxPerCampaign': 5000}
    # Fijar SOLO el diario no pisa el de campaña (merge por clave).
    r2 = adm['update'].lambda_handler(
        _admin({'customerId': 'CU1', 'limits': {'maxPerDay': 20000}}), None)
    assert r2['data']['sendingLimits'] == {'maxPerCampaign': 5000, 'maxPerDay': 20000}
    # Auditado como customer.limits.
    entries = adm['audit'].lambda_handler(_admin(), None)['data']['entries']
    assert any(e['action'] == 'customer.limits' and 'Acme' in e['target'] for e in entries)
    # Y List lo devuelve.
    customers = adm['list'].lambda_handler(_admin(), None)['data']['customers']
    c = next(c for c in customers if c['customerId'] == 'CU1')
    assert c['sendingLimits'] == {'maxPerCampaign': 5000, 'maxPerDay': 20000}


def test_update_limites_invalidos_400(adm):
    resp = adm['update'].lambda_handler(_admin({'customerId': 'CU1', 'limits': {}}), None)
    assert resp['statusCode'] == 400
    # Negativos se normalizan a 0 (= sin tope), no fallan.
    ok = adm['update'].lambda_handler(
        _admin({'customerId': 'CU1', 'limits': {'maxPerDay': -5}}), None)
    assert ok['statusCode'] == 200 and ok['data']['sendingLimits']['maxPerDay'] == 0
