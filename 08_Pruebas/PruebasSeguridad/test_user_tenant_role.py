"""
Pruebas de Api_V1_User_SetTenantRole (asignar sub-rol de empresa owner|approver|operator).
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
PATH = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_User_SetTenantRole' / 'lambda_function.py'


def _load():
    spec = importlib.util.spec_from_file_location('str_mod', str(PATH))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def env():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        ddb.create_table(TableName='user',
                         KeySchema=[{'AttributeName': 'userId', 'KeyType': 'HASH'}],
                         AttributeDefinitions=[{'AttributeName': 'userId', 'AttributeType': 'S'}],
                         BillingMode='PAY_PER_REQUEST')
        ddb.create_table(TableName='adminAudit',
                         KeySchema=[{'AttributeName': 'auditId', 'KeyType': 'HASH'}],
                         AttributeDefinitions=[{'AttributeName': 'auditId', 'AttributeType': 'S'}],
                         BillingMode='PAY_PER_REQUEST')
        t = boto3.resource('dynamodb', region_name='us-east-1').Table('user')
        t.put_item(Item={'userId': 'U1', 'customerId': 'CU1', 'email': 'owner@x.com', 'tenantRole': 'owner'})
        t.put_item(Item={'userId': 'U2', 'customerId': 'CU1', 'email': 'op@x.com', 'tenantRole': 'owner'})
        yield _load(), t


def _admin(body):
    return {**body, 'requestContext': {'authorizer': {'role': 'admin', 'user': 'root', 'userId': 'A0'}}}


def _client(body):
    return {**body, 'requestContext': {'authorizer': {'role': 'client', 'user': 'x', 'userId': 'X'}}}


def test_set_operator_ok(env):
    mod, t = env
    resp = mod.lambda_handler(_admin({'userId': 'U2', 'tenantRole': 'operator'}), None)
    assert resp['statusCode'] == 200
    assert t.get_item(Key={'userId': 'U2'})['Item']['tenantRole'] == 'operator'


def test_no_admin_403(env):
    mod, _ = env
    resp = mod.lambda_handler(_client({'userId': 'U2', 'tenantRole': 'operator'}), None)
    assert resp['statusCode'] == 403


def test_rol_invalido_400(env):
    mod, _ = env
    resp = mod.lambda_handler(_admin({'userId': 'U2', 'tenantRole': 'jefe'}), None)
    assert resp['statusCode'] == 400


def test_no_existe_404(env):
    mod, _ = env
    resp = mod.lambda_handler(_admin({'userId': 'NADA', 'tenantRole': 'operator'}), None)
    assert resp['statusCode'] == 404


def test_no_degradar_ultimo_owner(env):
    """Con 2 owners se puede degradar uno; el segundo (último) ya no."""
    mod, _ = env
    assert mod.lambda_handler(_admin({'userId': 'U2', 'tenantRole': 'operator'}), None)['statusCode'] == 200
    resp = mod.lambda_handler(_admin({'userId': 'U1', 'tenantRole': 'operator'}), None)
    assert resp['statusCode'] == 409
