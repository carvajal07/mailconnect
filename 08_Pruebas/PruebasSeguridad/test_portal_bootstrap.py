"""
Pruebas de la lambda de arranque del portal (Api_V1_Portal_Bootstrap): devuelve
campañas + bases + lista negra + plantillas de mensaje del cliente en 1 llamada,
con el tenant OBLIGATORIO del context del Authorizer.
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
    spec = importlib.util.spec_from_file_location('boot_' + folder, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _ctx(cid='CU1', cust='empresa'):
    return {'requestContext': {'authorizer': {'customerId': cid, 'customer': cust}}}


@pytest.fixture
def boot():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        for table, pk in [('campaign', 'campaignId'), ('databaseFile', 'databaseFileId'),
                          ('messageTemplate', 'messageTemplateId')]:
            ddb.create_table(
                TableName=table,
                KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
                AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
                BillingMode='PAY_PER_REQUEST')
        ddb.create_table(
            TableName='empresa_blackList',
            KeySchema=[{'AttributeName': 'email', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'email', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        # CU1 (empresa) tiene datos; CU2 (otra) no debe verlos.
        res.Table('campaign').put_item(Item={'campaignId': 'C1', 'customerId': 'CU1', 'campaignName': 'Promo', 'date': '2026-07-01'})
        res.Table('campaign').put_item(Item={'campaignId': 'C9', 'customerId': 'CU2', 'campaignName': 'Ajena', 'date': '2026-07-02'})
        res.Table('databaseFile').put_item(Item={'databaseFileId': 'D1', 'customerId': 'CU1', 'customer': 'empresa', 'fileName': 'base.csv', 'uploadDate': '2026-07-01T00:00:00Z'})
        res.Table('messageTemplate').put_item(Item={'messageTemplateId': 'M1', 'customerId': 'CU1', 'channel': 'SMS', 'name': 'Hola', 'created': '2026-07-01'})
        res.Table('empresa_blackList').put_item(Item={'email': 'malo@x.com', 'rejectionType': 'manual', 'date': '2026-07-01'})
        yield _load('Api_V1_Portal_Bootstrap')


def test_bootstrap_devuelve_todo_del_tenant(boot):
    resp = boot.lambda_handler(_ctx(), None)
    assert resp['statusCode'] == 200
    d = resp['data']
    assert [c['campaignName'] for c in d['campaigns']] == ['Promo']   # solo CU1
    assert [f['fileName'] for f in d['databases']] == ['base.csv']
    assert [t['name'] for t in d['messageTemplates']] == ['Hola']
    assert [b['email'] for b in d['blacklist']] == ['malo@x.com']
    assert d['errors'] == {}


def test_bootstrap_aislamiento_por_tenant(boot):
    # CU2 (otra) ve SOLO lo suyo (su campaña C9), nunca lo de CU1 (empresa).
    resp = boot.lambda_handler(_ctx(cid='CU2', cust='otra'), None)
    d = resp['data']
    assert [c['campaignName'] for c in d['campaigns']] == ['Ajena']  # no 'Promo' de CU1
    assert d['databases'] == []          # las bases eran de CU1
    assert d['messageTemplates'] == []   # las plantillas eran de CU1
    assert d['blacklist'] == []          # 'otra_blackList' no existe -> vacío
    assert d['errors'] == {}


def test_bootstrap_sin_token_403(boot):
    resp = boot.lambda_handler({}, None)  # sin context del Authorizer
    assert resp['statusCode'] == 403
