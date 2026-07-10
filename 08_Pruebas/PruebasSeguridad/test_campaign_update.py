"""
Pruebas de la lambda de editar campaña (Api_V1_Campaign_Update).
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
UPD_PATH = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Campaign_Update' / 'lambda_function.py'


def _load():
    spec = importlib.util.spec_from_file_location('upd_mod', str(UPD_PATH))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def upd():
    with mock_aws():
        boto3.client('dynamodb', region_name='us-east-1').create_table(
            TableName='campaign',
            KeySchema=[{'AttributeName': 'campaignId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'campaignId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        t = boto3.resource('dynamodb', region_name='us-east-1').Table('campaign')
        t.put_item(Item={'campaignId': 'C1', 'customerId': 'CU1', 'campaignName': 'Vieja',
                         'channel': 'EM', 'campaignState': 'Pendiente', 'dataPath': 'x/a.csv', 'template': 't1'})
        t.put_item(Item={'campaignId': 'C2', 'customerId': 'CU1', 'campaignName': 'Enviada',
                         'channel': 'EM', 'campaignState': 'Enviando'})
        yield _load(), t


def _auth(body, cid='CU1'):
    return {**body, 'requestContext': {'authorizer': {'customerId': cid}}}


def test_update_ok_cambia_canal_y_base(upd):
    mod, t = upd
    resp = mod.lambda_handler(_auth({'campaignId': 'C1', 'channelName': 'SMS', 'dataPath': 'y/b.csv'}), None)
    assert resp['statusCode'] == 200
    item = t.get_item(Key={'campaignId': 'C1'})['Item']
    assert item['channel'] == 'SMS' and item['dataPath'] == 'y/b.csv'
    assert item['campaignName'] == 'Vieja'  # lo no enviado no cambia


def test_update_solo_pendiente(upd):
    mod, _ = upd
    resp = mod.lambda_handler(_auth({'campaignId': 'C2', 'channelName': 'SMS'}), None)
    assert resp['statusCode'] == 409  # Enviando no se edita


def test_update_otro_cliente_prohibido(upd):
    mod, _ = upd
    resp = mod.lambda_handler(_auth({'campaignId': 'C1', 'channelName': 'SMS'}, cid='CU2'), None)
    assert resp['statusCode'] == 403


def test_update_no_existe(upd):
    mod, _ = upd
    resp = mod.lambda_handler(_auth({'campaignId': 'NADA', 'channelName': 'SMS'}), None)
    assert resp['statusCode'] == 404


def test_update_sin_campos(upd):
    mod, _ = upd
    resp = mod.lambda_handler(_auth({'campaignId': 'C1'}), None)
    assert resp['statusCode'] == 400
