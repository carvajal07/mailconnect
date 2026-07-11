"""
Pruebas de la gestión de la LISTA NEGRA por cliente (List / Add / Delete), sobre la
tabla {customer}_blackList (PK 'email'), multi-tenant por nombre de empresa.
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
    spec = importlib.util.spec_from_file_location('bl_' + folder, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def bl():
    with mock_aws():
        # La tabla customer permite resolver customerId -> company (por si se usa).
        boto3.client('dynamodb', region_name='us-east-1').create_table(
            TableName='customer',
            KeySchema=[{'AttributeName': 'customerId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'customerId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        boto3.resource('dynamodb', region_name='us-east-1').Table('customer').put_item(
            Item={'customerId': 'CU1', 'company': 'empresa'})
        yield _load('Api_V1_Blacklist_List'), _load('Api_V1_Blacklist_Add'), _load('Api_V1_Blacklist_Delete')


def _auth(body, customer='empresa'):
    return {**body, 'requestContext': {'authorizer': {'customer': customer, 'customerId': 'CU1'}}}


def test_lista_vacia_si_no_existe_tabla(bl):
    lst, _, _ = bl
    resp = lst.lambda_handler(_auth({}), None)
    assert resp['statusCode'] == 200
    assert resp['data']['count'] == 0


def test_agregar_y_listar(bl):
    lst, add, _ = bl
    assert add.lambda_handler(_auth({'email': 'malo@test.com', 'reason': 'spam'}), None)['statusCode'] == 201
    resp = lst.lambda_handler(_auth({}), None)
    assert resp['data']['count'] == 1
    item = resp['data']['items'][0]
    assert item['email'] == 'malo@test.com'
    assert item['description'] == 'spam'


def test_agregar_celular(bl):
    # La lista negra sirve para cualquier contacto (correo o celular E.164).
    _, add, _ = bl
    assert add.lambda_handler(_auth({'email': '+573001112233'}), None)['statusCode'] == 201


def test_agregar_sin_contacto_400(bl):
    _, add, _ = bl
    assert add.lambda_handler(_auth({}), None)['statusCode'] == 400


def test_quitar(bl):
    lst, add, delete = bl
    add.lambda_handler(_auth({'email': 'malo@test.com'}), None)
    assert delete.lambda_handler(_auth({'email': 'malo@test.com'}), None)['statusCode'] == 200
    assert lst.lambda_handler(_auth({}), None)['data']['count'] == 0


def test_quitar_inexistente_404(bl):
    _, add, delete = bl
    add.lambda_handler(_auth({'email': 'otro@test.com'}), None)  # crea la tabla
    assert delete.lambda_handler(_auth({'email': 'nope@test.com'}), None)['statusCode'] == 404


def test_multitenant_no_ve_otra_empresa(bl):
    lst, add, _ = bl
    add.lambda_handler(_auth({'email': 'a@test.com'}, customer='empresa'), None)
    # Otra empresa (otro nombre) tiene su propia tabla → no ve la de 'empresa'.
    resp = lst.lambda_handler(_auth({}, customer='otraempresa'), None)
    assert resp['data']['count'] == 0
