"""
Pruebas del BLOQUEO PROGRESIVO por intentos fallidos de login (Api_V1_Security_Login).

Regla: al 2º fallo se avisa que queda 1 intento; al 3º la cuenta se bloquea 5 minutos.
Al expirar ese bloqueo, UN nuevo fallo bloquea 1 hora; el siguiente, 24 horas (y ahí
se mantiene). Un login correcto con la cuenta desbloqueada limpia contador y escalera.
Durante un bloqueo vigente se rechaza el ingreso aunque la contraseña sea correcta.

100% local con moto (DynamoDB). Independiente de test_seguridad.py.
"""
import os
import time
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')
os.environ.setdefault('SECRET_KEY', 'test-secret-key-para-pruebas-32bytes!')
# Bajar el costo del hash en pruebas (el default real 600k se verifica en test_seguridad).
os.environ.setdefault('PBKDF2_ITERATIONS', '60000')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
LOGIN_PATH = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Security_Login' / 'lambda_function.py'

PASSWORD = 'Password123'
EMAIL = 'bloqueo@test.com'


def _load_login():
    spec = importlib.util.spec_from_file_location('mc_login_lockout', str(LOGIN_PATH))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def env():
    """Login + tablas mínimas con un usuario ACTIVO listo para autenticar."""
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        ddb.create_table(
            TableName='user',
            KeySchema=[{'AttributeName': 'userId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'userId', 'AttributeType': 'S'},
                                  {'AttributeName': 'email', 'AttributeType': 'S'}],
            GlobalSecondaryIndexes=[{
                'IndexName': 'email-index',
                'KeySchema': [{'AttributeName': 'email', 'KeyType': 'HASH'}],
                'Projection': {'ProjectionType': 'ALL'}}],
            BillingMode='PAY_PER_REQUEST')
        for name, pk in (('customer', 'customerId'), ('userData', 'userDataId'),
                         ('session', 'sessionId'), ('adminAudit', 'auditId')):
            ddb.create_table(
                TableName=name,
                KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
                AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
                BillingMode='PAY_PER_REQUEST')

        login = _load_login()
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'Acme', 'companyTin': '900'})
        res.Table('userData').put_item(Item={'userDataId': 'D1', 'userName': 'Ana'})
        salt = 'salt-fijo'
        res.Table('user').put_item(Item={
            'userId': 'U1', 'email': EMAIL, 'active': True, 'customerId': 'CU1',
            'userDataId': 'D1', 'userSalt': salt,
            'userHash': login._hash_password(PASSWORD, salt),
        })
        yield login, res.Table('user')


def _try(login, password):
    return login.lambda_handler({'user': EMAIL, 'password': password}, None)


def _expire_lock(user_table):
    """Simula que el bloqueo vigente ya venció (lockUntil en el pasado)."""
    user_table.update_item(
        Key={'userId': 'U1'},
        UpdateExpression='SET lockUntil = :u',
        ExpressionAttributeValues={':u': int(time.time()) - 10})


def test_dos_fallos_avisa_que_queda_un_intento(env):
    login, _ = env
    assert _try(login, 'Errada1x')['statusCode'] == 404
    resp = _try(login, 'Errada2x')
    assert resp['statusCode'] == 404
    assert 'queda 1 intento' in resp['description'].lower()


def test_tercer_fallo_bloquea_5_minutos_incluso_con_clave_correcta(env):
    login, _ = env
    _try(login, 'Errada1x')
    _try(login, 'Errada2x')
    resp = _try(login, 'Errada3x')
    assert resp['statusCode'] == 429
    assert '5 minutos' in resp['description']
    # Con el bloqueo VIGENTE ni la contraseña correcta entra (si no, el bloqueo
    # no frenaría la fuerza bruta que acierta).
    resp = _try(login, PASSWORD)
    assert resp['statusCode'] == 429


def test_escalada_1_hora_y_24_horas(env):
    login, user_table = env
    for pwd in ('Errada1x', 'Errada2x', 'Errada3x'):
        _try(login, pwd)                       # → bloqueo de 5 min
    _expire_lock(user_table)                   # se habilita de nuevo…
    resp = _try(login, 'Errada4x')             # …y UN solo fallo escala
    assert resp['statusCode'] == 429
    assert '1 hora' in resp['description']
    _expire_lock(user_table)
    resp = _try(login, 'Errada5x')
    assert resp['statusCode'] == 429
    assert '24 horas' in resp['description']
    _expire_lock(user_table)
    resp = _try(login, 'Errada6x')             # se mantiene en 24 h
    assert resp['statusCode'] == 429
    assert '24 horas' in resp['description']


def test_login_correcto_desbloqueado_resetea_contador_y_escalera(env):
    login, user_table = env
    _try(login, 'Errada1x')
    _try(login, 'Errada2x')
    assert _try(login, PASSWORD)['statusCode'] == 200   # resetea el contador
    # Tras el reset, dos fallos vuelven a AVISAR (no bloquean): el conteo arrancó de cero.
    _try(login, 'Errada1x')
    resp = _try(login, 'Errada2x')
    assert resp['statusCode'] == 404
    assert 'queda 1 intento' in resp['description'].lower()

    # También limpia la ESCALERA: tras un bloqueo expirado, el login correcto
    # resetea la etapa y el siguiente ciclo de fallos vuelve a empezar en 5 min.
    _try(login, 'Errada3x')                    # → bloqueo (5 min)
    _expire_lock(user_table)
    assert _try(login, PASSWORD)['statusCode'] == 200
    for pwd in ('ErradaAx', 'ErradaBx'):
        _try(login, pwd)
    resp = _try(login, 'ErradaCx')
    assert resp['statusCode'] == 429
    assert '5 minutos' in resp['description']  # etapa reiniciada (no 1 hora)


def test_login_emite_sid_y_sesion_activa(env):
    login, _ = env
    resp = _try(login, PASSWORD)
    assert resp['statusCode'] == 200
    import jwt as pyjwt
    claims = pyjwt.decode(resp['data']['token'], os.environ['SECRET_KEY'], algorithms=['HS256'])
    assert claims['sid']
    ses = boto3.resource('dynamodb', region_name='us-east-1').Table('session') \
        .get_item(Key={'sessionId': claims['sid']}).get('Item')
    assert ses and ses['active'] is True
