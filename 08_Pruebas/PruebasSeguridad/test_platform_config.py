"""
Pruebas de la configuración de plataforma (Config/Get, Config/Set) y de que las
lambdas consumidoras (Create-otp) leen el ajuste con fallback a env.
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
    spec = importlib.util.spec_from_file_location('cfg_' + folder, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _admin(payload=None):
    return {'body': None, 'requestContext': {'authorizer': {'role': 'admin'}}, **(payload or {})}


@pytest.fixture
def cfg():
    with mock_aws():
        # Config/Set crea la tabla sola; no la pre-creamos para probar ese camino.
        yield _load('Api_V1_Config_Get'), _load('Api_V1_Config_Set')


def test_get_requiere_admin(cfg):
    get, _ = cfg
    assert get.lambda_handler({'requestContext': {'authorizer': {'role': 'client'}}}, None)['statusCode'] == 403


def test_set_requiere_admin(cfg):
    _, setter = cfg
    resp = setter.lambda_handler({'requestContext': {'authorizer': {'role': 'client'}}, 'key': 'SENDER_EMAIL', 'value': 'x@y.co'}, None)
    assert resp['statusCode'] == 403


def test_get_devuelve_defaults_sin_tabla(cfg):
    get, _ = cfg
    resp = get.lambda_handler(_admin(), None)
    assert resp['statusCode'] == 200
    keys = {s['key']: s for s in resp['data']['settings']}
    assert keys['OTP_EXPIRATION_MIN']['value'] == 5
    assert keys['OTP_EXPIRATION_MIN']['isOverridden'] is False
    assert 'Create-otp' in keys['OTP_EXPIRATION_MIN']['consumers']


def test_set_y_get_refleja_override(cfg):
    get, setter = cfg
    assert setter.lambda_handler(_admin({'key': 'OTP_EXPIRATION_MIN', 'value': 12}), None)['statusCode'] == 200
    resp = get.lambda_handler(_admin(), None)
    otp = next(s for s in resp['data']['settings'] if s['key'] == 'OTP_EXPIRATION_MIN')
    assert otp['value'] == 12 and otp['isOverridden'] is True


def test_set_key_invalida_400(cfg):
    _, setter = cfg
    assert setter.lambda_handler(_admin({'key': 'HACK', 'value': 'x'}), None)['statusCode'] == 400


def test_set_email_invalido_400(cfg):
    _, setter = cfg
    assert setter.lambda_handler(_admin({'key': 'SENDER_EMAIL', 'value': 'sin-arroba'}), None)['statusCode'] == 400


def test_set_numero_invalido_400(cfg):
    _, setter = cfg
    assert setter.lambda_handler(_admin({'key': 'OTP_EXPIRATION_MIN', 'value': 'abc'}), None)['statusCode'] == 400


def test_create_otp_consume_expiracion_de_config(cfg):
    """Create-otp debe tomar la vigencia del OTP desde platformConfig si existe."""
    _, setter = cfg
    setter.lambda_handler(_admin({'key': 'OTP_EXPIRATION_MIN', 'value': 9}), None)

    # Tablas que necesita Create-otp.
    ddb = boto3.resource('dynamodb', region_name='us-east-1')
    ddb.create_table(TableName='user', KeySchema=[{'AttributeName': 'userId', 'KeyType': 'HASH'}],
                     AttributeDefinitions=[{'AttributeName': 'userId', 'AttributeType': 'S'}], BillingMode='PAY_PER_REQUEST')
    ddb.Table('user').put_item(Item={'userId': 'U1', 'email': 'a@b.co', 'active': True})
    ddb.create_table(TableName='oneTimePassword', KeySchema=[{'AttributeName': 'oneTimePasswordId', 'KeyType': 'HASH'}],
                     AttributeDefinitions=[{'AttributeName': 'oneTimePasswordId', 'AttributeType': 'S'}], BillingMode='PAY_PER_REQUEST')
    boto3.client('ses', region_name='us-east-1').verify_email_identity(EmailAddress='comunicaciones@mailconnect.com.co')

    create = _load('Api_V1_Security_Create-otp')
    resp = create.lambda_handler({'userId': 'U1', 'ip': '1.1.1.1'}, None)
    assert resp['statusCode'] == 201
    otp_id = resp['data']['otpId']
    item = ddb.Table('oneTimePassword').get_item(Key={'oneTimePasswordId': otp_id})['Item']
    # expirationTime ≈ ahora + 9 min (no 5). Verificamos que quedó > 8 min.
    import time
    assert item['expirationTime'] - int(time.time()) > 8 * 60
