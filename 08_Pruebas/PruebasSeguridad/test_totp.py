"""
Pruebas del SEGUNDO FACTOR (2FA TOTP, Bloque I): gestión (Api_V1_Security_Totp),
el desafío que emite Login cuando el usuario tiene 2FA, y la finalización del ingreso
(Api_V1_Security_Verify-2fa) con código TOTP o de respaldo, incluyendo el tope de
intentos. DynamoDB con moto.
"""
import os
import time
import base64
import struct
import hmac
import hashlib
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402
import helpers_auth  # noqa: E402,F401  (fija SECRET_KEY antes de cargar las lambdas)

REPO_ROOT = Path(__file__).resolve().parents[2]
DIR = REPO_ROOT / '04_Backend' / 'lambdas'


def _load(folder, name):
    p = DIR / folder / 'lambda_function.py'
    spec = importlib.util.spec_from_file_location(name, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _totp_now(secret_b32, at=None):
    """Genera el código TOTP actual (para simular la app del usuario)."""
    counter = int(at if at is not None else time.time()) // 30
    key = base64.b32decode(secret_b32 + '=' * (-len(secret_b32) % 8), casefold=True)
    digest = hmac.new(key, struct.pack('>Q', counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1000000
    return str(code).zfill(6)


def _mk_user_tables():
    ddb = boto3.client('dynamodb', region_name='us-east-1')
    ddb.create_table(TableName='user', KeySchema=[{'AttributeName': 'userId', 'KeyType': 'HASH'}],
                     AttributeDefinitions=[{'AttributeName': 'userId', 'AttributeType': 'S'}],
                     BillingMode='PAY_PER_REQUEST')


def _totp_event(action, user_id='U1', **extra):
    return {'action': action, 'requestContext': {'authorizer': {'userId': user_id}}, **extra}


# ───────────────────────── Gestión (enroll/activate/disable) ─────────────────────────

@pytest.fixture
def totp():
    with mock_aws():
        _mk_user_tables()
        boto3.resource('dynamodb', region_name='us-east-1').Table('user').put_item(
            Item={'userId': 'U1', 'email': 'ana@acme.co'})
        yield _load('Api_V1_Security_Totp', 'totp_mod')


def test_status_sin_2fa(totp):
    resp = totp.lambda_handler(_totp_event('status'), None)
    assert resp['statusCode'] == 200 and resp['data']['enabled'] is False


def test_enroll_y_activate(totp):
    enroll = totp.lambda_handler(_totp_event('enroll'), None)
    assert enroll['statusCode'] == 200
    secret = enroll['data']['secret']
    assert enroll['data']['otpauthUri'].startswith('otpauth://totp/')

    # Código incorrecto → 401, no se activa.
    assert totp.lambda_handler(_totp_event('activate', code='000000'), None)['statusCode'] == 401

    # Código correcto → activa + devuelve 10 códigos de respaldo.
    ok = totp.lambda_handler(_totp_event('activate', code=_totp_now(secret)), None)
    assert ok['statusCode'] == 200 and ok['data']['enabled'] is True
    assert len(ok['data']['backupCodes']) == 10

    item = boto3.resource('dynamodb', region_name='us-east-1').Table('user').get_item(
        Key={'userId': 'U1'})['Item']
    assert item['totpEnabled'] is True and item['totpSecret'] == secret
    assert 'totpPendingSecret' not in item

    st = totp.lambda_handler(_totp_event('status'), None)
    assert st['data']['enabled'] is True


def test_disable_requiere_codigo_valido(totp):
    enroll = totp.lambda_handler(_totp_event('enroll'), None)
    secret = enroll['data']['secret']
    totp.lambda_handler(_totp_event('activate', code=_totp_now(secret)), None)

    # Sin código válido → 401.
    assert totp.lambda_handler(_totp_event('disable', code='000000'), None)['statusCode'] == 401
    # Con el código de la app → desactiva.
    ok = totp.lambda_handler(_totp_event('disable', code=_totp_now(secret)), None)
    assert ok['statusCode'] == 200 and ok['data']['enabled'] is False
    item = boto3.resource('dynamodb', region_name='us-east-1').Table('user').get_item(
        Key={'userId': 'U1'})['Item']
    assert item.get('totpEnabled') is False and 'totpSecret' not in item


def test_sin_identidad_403(totp):
    assert totp.lambda_handler({'action': 'status', 'requestContext': {'authorizer': {}}}, None)['statusCode'] == 403


# ───────────────────────── Login → desafío + Verify-2fa ─────────────────────────

def _mk_login_tables():
    ddb = boto3.client('dynamodb', region_name='us-east-1')
    ddb.create_table(
        TableName='user', KeySchema=[{'AttributeName': 'userId', 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': 'userId', 'AttributeType': 'S'},
                              {'AttributeName': 'email', 'AttributeType': 'S'}],
        GlobalSecondaryIndexes=[{'IndexName': 'email-index',
                                 'KeySchema': [{'AttributeName': 'email', 'KeyType': 'HASH'}],
                                 'Projection': {'ProjectionType': 'ALL'}}],
        BillingMode='PAY_PER_REQUEST')
    for t, pk in [('customer', 'customerId'), ('userData', 'userDataId'),
                  ('session', 'sessionId'), ('adminAudit', 'auditId')]:
        ddb.create_table(TableName=t, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
                         AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
                         BillingMode='PAY_PER_REQUEST')


@pytest.fixture
def flow():
    with mock_aws():
        _mk_login_tables()
        login = _load('Api_V1_Security_Login', 'login_2fa')
        verify = _load('Api_V1_Security_Verify-2fa', 'verify_2fa')
        totp = _load('Api_V1_Security_Totp', 'totp_flow')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        # Usuario con contraseña 'Secret123' (hash pbkdf2 vía el propio Login).
        salt = 'salt1'
        res.Table('user').put_item(Item={
            'userId': 'U1', 'email': 'ana@acme.co', 'active': True, 'customerId': 'CU1',
            'userDataId': 'UD1', 'role': 'client', 'tenantRole': 'owner',
            'userHash': login._hash_password('Secret123', salt), 'userSalt': salt})
        res.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'Acme', 'companyTin': '900'})
        res.Table('userData').put_item(Item={'userDataId': 'UD1', 'userName': 'Ana'})
        yield {'login': login, 'verify': verify, 'totp': totp, 'res': res}


def _enable_2fa(flow):
    secret = flow['totp'].lambda_handler(_totp_event('enroll'), None)['data']['secret']
    act = flow['totp'].lambda_handler(_totp_event('activate', code=_totp_now(secret)), None)
    return secret, act['data']['backupCodes']


def test_login_sin_2fa_da_token(flow):
    resp = flow['login'].lambda_handler({'user': 'ana@acme.co', 'password': 'Secret123'}, None)
    assert resp['statusCode'] == 200
    assert resp['data']['token'] and resp['data']['twofaRequired'] is False


def test_login_con_2fa_pide_desafio(flow):
    _enable_2fa(flow)
    resp = flow['login'].lambda_handler({'user': 'ana@acme.co', 'password': 'Secret123'}, None)
    assert resp['statusCode'] == 200
    assert resp['data']['twofaRequired'] is True
    assert resp['data']['challenge'] and not resp['data']['token']


def test_verify_2fa_con_totp_da_token(flow):
    secret, _ = _enable_2fa(flow)
    login = flow['login'].lambda_handler({'user': 'ana@acme.co', 'password': 'Secret123'}, None)
    challenge = login['data']['challenge']
    resp = flow['verify'].lambda_handler({'challenge': challenge, 'code': _totp_now(secret)}, None)
    assert resp['statusCode'] == 200
    assert resp['data']['token'] and resp['data']['customer'] == 'Acme'
    # La sesión quedó creada (el token es revocable).
    assert flow['res'].Table('session').scan()['Count'] == 1


def test_verify_2fa_con_codigo_de_respaldo(flow):
    _secret, backups = _enable_2fa(flow)
    challenge = flow['login'].lambda_handler(
        {'user': 'ana@acme.co', 'password': 'Secret123'}, None)['data']['challenge']
    resp = flow['verify'].lambda_handler({'challenge': challenge, 'code': backups[0]}, None)
    assert resp['statusCode'] == 200 and resp['data']['token']
    assert resp['data']['backupCodesRemaining'] == 9
    # El código de respaldo se consumió (no sirve dos veces).
    challenge2 = flow['login'].lambda_handler(
        {'user': 'ana@acme.co', 'password': 'Secret123'}, None)['data']['challenge']
    again = flow['verify'].lambda_handler({'challenge': challenge2, 'code': backups[0]}, None)
    assert again['statusCode'] == 401


def test_verify_2fa_codigo_malo_y_tope_de_intentos(flow):
    _enable_2fa(flow)
    challenge = flow['login'].lambda_handler(
        {'user': 'ana@acme.co', 'password': 'Secret123'}, None)['data']['challenge']
    for _ in range(5):
        r = flow['verify'].lambda_handler({'challenge': challenge, 'code': '000000'}, None)
        assert r['statusCode'] == 401
    # Al 6º intento (ya con 5 fallos) → 429.
    r = flow['verify'].lambda_handler({'challenge': challenge, 'code': '000000'}, None)
    assert r['statusCode'] == 429


def test_verify_2fa_desafio_invalido_401(flow):
    _enable_2fa(flow)
    r = flow['verify'].lambda_handler({'challenge': 'no.es.un.jwt', 'code': '123456'}, None)
    assert r['statusCode'] == 401
