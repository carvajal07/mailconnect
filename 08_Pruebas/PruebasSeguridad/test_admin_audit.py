"""
Pruebas de la auditoría admin: el lector Admin/Audit (gating + filtros) y que las
lambdas que mutan (Customer_Update, User_SetRole, Pricing_Update, Config_Set)
registran un evento en adminAudit.
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
    spec = importlib.util.spec_from_file_location('aud_' + folder, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _admin(payload=None, user='ana@acme.co'):
    return {'body': None,
            'requestContext': {'authorizer': {'role': 'admin', 'user': user, 'userId': 'U1', 'customer': 'Acme'}},
            **(payload or {})}


def _pk(name, pk):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}], BillingMode='PAY_PER_REQUEST')


def _pk_sk(name, pk, sk):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name,
        KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}, {'AttributeName': sk, 'KeyType': 'RANGE'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}, {'AttributeName': sk, 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


@pytest.fixture
def env():
    with mock_aws():
        _pk('adminAudit', 'auditId')
        yield


def test_audit_requiere_admin(env):
    audit = _load('Api_V1_Admin_Audit')
    assert audit.lambda_handler({'requestContext': {'authorizer': {'role': 'client'}}}, None)['statusCode'] == 403


def test_audit_vacia_sin_tabla():
    # Sin la tabla adminAudit, el lector devuelve vacío (no error).
    with mock_aws():
        audit = _load('Api_V1_Admin_Audit')
        resp = audit.lambda_handler(_admin(), None)
        assert resp['statusCode'] == 200 and resp['data']['entries'] == []


def test_customer_update_registra_evento(env):
    _pk('customer', 'customerId')
    boto3.resource('dynamodb', region_name='us-east-1').Table('customer').put_item(
        Item={'customerId': 'CU1', 'company': 'Acme', 'realSendEnabled': True})
    upd = _load('Api_V1_Customer_Update')
    upd.lambda_handler(_admin({'customerId': 'CU1', 'realSendEnabled': False}), None)

    audit = _load('Api_V1_Admin_Audit')
    entries = audit.lambda_handler(_admin(), None)['data']['entries']
    assert len(entries) == 1
    e = entries[0]
    assert e['action'] == 'customer.realSend' and e['actor'] == 'ana@acme.co' and e['target'] == 'CU1'
    assert 'deshabilitados' in e['detail']


def test_setrole_registra_evento(env):
    _pk('user', 'userId')
    ddb = boto3.resource('dynamodb', region_name='us-east-1')
    ddb.Table('user').put_item(Item={'userId': 'U2', 'role': 'client'})
    ddb.Table('user').put_item(Item={'userId': 'U9', 'role': 'admin'})  # otro admin
    setrole = _load('Api_V1_User_SetRole')
    setrole.lambda_handler(_admin({'userId': 'U2', 'role': 'admin'}), None)

    audit = _load('Api_V1_Admin_Audit')
    e = audit.lambda_handler(_admin(), None)['data']['entries'][0]
    assert e['action'] == 'user.role' and e['target'] == 'U2' and 'admin' in e['detail']


def test_config_set_registra_evento(env):
    setter = _load('Api_V1_Config_Set')
    setter.lambda_handler(_admin({'key': 'OTP_EXPIRATION_MIN', 'value': 8}), None)

    audit = _load('Api_V1_Admin_Audit')
    e = audit.lambda_handler(_admin(), None)['data']['entries'][0]
    assert e['action'] == 'config.set' and e['target'] == 'OTP_EXPIRATION_MIN'


def test_audit_filtra_por_accion(env):
    _pk('customer', 'customerId')
    boto3.resource('dynamodb', region_name='us-east-1').Table('customer').put_item(
        Item={'customerId': 'CU1', 'company': 'Acme', 'realSendEnabled': True})
    _load('Api_V1_Customer_Update').lambda_handler(_admin({'customerId': 'CU1', 'realSendEnabled': False}), None)
    _load('Api_V1_Config_Set').lambda_handler(_admin({'key': 'SENDER_EMAIL', 'value': 'x@y.co'}), None)

    audit = _load('Api_V1_Admin_Audit')
    todos = audit.lambda_handler(_admin(), None)['data']
    assert todos['count'] == 2
    assert set(todos['actions']) == {'customer.realSend', 'config.set'}
    solo_config = audit.lambda_handler(_admin({'action': 'config.set'}), None)['data']['entries']
    assert [e['action'] for e in solo_config] == ['config.set']


def test_audit_filtra_por_actor(env):
    _load('Api_V1_Config_Set').lambda_handler(_admin({'key': 'SENDER_EMAIL', 'value': 'x@y.co'}, user='beto@acme.co'), None)
    _load('Api_V1_Config_Set').lambda_handler(_admin({'key': 'OTP_EXPIRATION_MIN', 'value': 7}, user='ana@acme.co'), None)

    audit = _load('Api_V1_Admin_Audit')
    solo_ana = audit.lambda_handler(_admin({'actor': 'ana'}), None)['data']['entries']
    assert len(solo_ana) == 1 and solo_ana[0]['actor'] == 'ana@acme.co'
