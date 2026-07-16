"""
Pruebas de Api_V1_Admin_Campaigns: vista GLOBAL (admin) de campañas de TODOS los
clientes, con el nombre de empresa unido y filtros por mes/estado/cliente/canal.
"""
import os
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DIR = REPO_ROOT / '04_Backend' / 'lambdas'


def _load(folder):
    p = DIR / folder / 'lambda_function.py'
    spec = importlib.util.spec_from_file_location('adcamp_' + folder, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _admin(payload=None):
    return {'body': None,
            'requestContext': {'authorizer': {'role': 'admin', 'user': 'ana@acme.co'}},
            **(payload or {})}


def _pk(name, pk):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}], BillingMode='PAY_PER_REQUEST')


@pytest.fixture
def env():
    with mock_aws():
        _pk('campaign', 'campaignId')
        _pk('customer', 'customerId')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'Acme', 'companyTin': '900'})
        res.Table('customer').put_item(Item={'customerId': 'CU2', 'company': 'Beta', 'companyTin': '901'})
        res.Table('campaign').put_item(Item={'campaignId': 'C1', 'customerId': 'CU1', 'campaignName': 'Promo Acme', 'channel': 'EM', 'campaignState': 'Pendiente', 'date': '2026-07-01 10:00:00'})
        res.Table('campaign').put_item(Item={'campaignId': 'C2', 'customerId': 'CU2', 'campaignName': 'SMS Beta', 'channel': 'SMS', 'campaignState': 'Terminada', 'date': '2026-06-15 10:00:00'})
        res.Table('campaign').put_item(Item={'campaignId': 'C3', 'customerId': 'CU1', 'campaignName': 'Otra Acme', 'channel': 'EM', 'campaignState': 'Terminada', 'date': '2026-07-05 10:00:00'})
        yield _load('Api_V1_Admin_Campaigns')


def test_requiere_admin(env):
    resp = env.lambda_handler({'requestContext': {'authorizer': {'role': 'client'}}}, None)
    assert resp['statusCode'] == 403


def test_lista_todas_con_empresa(env):
    d = env.lambda_handler(_admin(), None)['data']
    assert d['count'] == 3
    # Cada campaña trae la empresa unida.
    by_id = {c['campaignId']: c for c in d['campaigns']}
    assert by_id['C1']['company'] == 'Acme'
    assert by_id['C2']['company'] == 'Beta'
    # Orden reciente primero.
    assert [c['campaignId'] for c in d['campaigns']] == ['C3', 'C1', 'C2']
    # Catálogo de clientes para el filtro.
    assert {c['company'] for c in d['customers']} == {'Acme', 'Beta'}


def test_filtra_por_cliente(env):
    d = env.lambda_handler(_admin({'customerId': 'CU2'}), None)['data']
    assert [c['campaignId'] for c in d['campaigns']] == ['C2']


def test_filtra_por_estado_y_canal(env):
    d = env.lambda_handler(_admin({'state': 'Terminada'}), None)['data']
    assert {c['campaignId'] for c in d['campaigns']} == {'C2', 'C3'}
    d2 = env.lambda_handler(_admin({'channel': 'SMS'}), None)['data']
    assert [c['campaignId'] for c in d2['campaigns']] == ['C2']


def test_filtra_por_mes(env):
    d = env.lambda_handler(_admin({'month': '2026-06'}), None)['data']
    assert [c['campaignId'] for c in d['campaigns']] == ['C2']
