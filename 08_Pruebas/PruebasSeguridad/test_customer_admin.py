"""
Pruebas de los endpoints admin de clientes: Customer/List y Customer/Update
(habilitar/deshabilitar los envíos reales por cliente).
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
    spec = importlib.util.spec_from_file_location('cust_' + folder, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def cust():
    with mock_aws():
        boto3.client('dynamodb', region_name='us-east-1').create_table(
            TableName='customer',
            KeySchema=[{'AttributeName': 'customerId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'customerId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'Beta', 'companyTin': '900', 'realSendEnabled': True})
        res.Table('customer').put_item(Item={'customerId': 'CU2', 'company': 'Alfa', 'companyTin': '901'})  # sin campo
        yield _load('Api_V1_Customer_List'), _load('Api_V1_Customer_Update')


def test_list_ordena_y_default_habilitado(cust):
    lst, _ = cust
    resp = lst.lambda_handler({}, None)
    assert resp['statusCode'] == 200
    customers = resp['data']['customers']
    # Orden alfabético por empresa: Alfa antes que Beta.
    assert [c['company'] for c in customers] == ['Alfa', 'Beta']
    # El que no tiene el campo se reporta habilitado (fail-open).
    alfa = next(c for c in customers if c['company'] == 'Alfa')
    assert alfa['realSendEnabled'] is True


def test_update_deshabilita(cust):
    _, upd = cust
    resp = upd.lambda_handler({'customerId': 'CU1', 'realSendEnabled': False}, None)
    assert resp['statusCode'] == 200
    item = boto3.resource('dynamodb', region_name='us-east-1').Table('customer').get_item(Key={'customerId': 'CU1'})['Item']
    assert item['realSendEnabled'] is False


def test_update_acepta_string(cust):
    _, upd = cust
    upd.lambda_handler({'customerId': 'CU2', 'realSendEnabled': 'false'}, None)
    item = boto3.resource('dynamodb', region_name='us-east-1').Table('customer').get_item(Key={'customerId': 'CU2'})['Item']
    assert item['realSendEnabled'] is False


def test_update_cliente_inexistente_404(cust):
    _, upd = cust
    assert upd.lambda_handler({'customerId': 'NOPE', 'realSendEnabled': True}, None)['statusCode'] == 404


def test_update_sin_datos_400(cust):
    _, upd = cust
    assert upd.lambda_handler({'customerId': 'CU1'}, None)['statusCode'] == 400
