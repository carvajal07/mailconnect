"""
Pruebas de registro/listado de bases de datos (databaseFile), incluyendo el fallback
por nombre de empresa cuando el customerId no coincide (causa del listado vacío).
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
    spec = importlib.util.spec_from_file_location('db_' + folder, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def db():
    with mock_aws():
        boto3.client('dynamodb', region_name='us-east-1').create_table(
            TableName='databaseFile',
            KeySchema=[{'AttributeName': 'databaseFileId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'databaseFileId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        yield _load('Api_V1_Database_Register-file'), _load('Api_V1_Database_List'), _load('Api_V1_Database_Delete')


def _register(reg, **kw):
    body = {'customerId': 'CU1', 'customer': 'empresa', 'fileName': 'base.csv',
            's3Path': 'x/base.csv', 'totalRecords': 100, 'channel': 'EMAIL'}
    body.update(kw)
    return reg.lambda_handler(body, None)


def test_registrar_y_listar_por_customerid(db):
    reg, lst, _ = db
    assert _register(reg)['statusCode'] == 201
    resp = lst.lambda_handler({'customerId': 'CU1', 'customer': 'empresa'}, None)
    assert resp['statusCode'] == 200
    assert [f['fileName'] for f in resp['data']['files']] == ['base.csv']


def test_guarda_channel(db):
    reg, lst, _ = db
    _register(reg, channel='SMS')
    resp = lst.lambda_handler({'customerId': 'CU1'}, None)
    assert resp['data']['files'][0]['channel'] == 'SMS'


def test_guarda_y_lista_columns(db):
    # Los encabezados del CSV se guardan como campos usables en plantillas.
    reg, lst, _ = db
    _register(reg, columns=['Identificacion', 'Correo', 'Nombre', 'Ciudad'])
    resp = lst.lambda_handler({'customerId': 'CU1'}, None)
    assert resp['data']['files'][0]['columns'] == ['Identificacion', 'Correo', 'Nombre', 'Ciudad']


def test_columns_por_defecto_lista_vacia(db):
    reg, lst, _ = db
    _register(reg)  # sin columns
    resp = lst.lambda_handler({'customerId': 'CU1'}, None)
    assert resp['data']['files'][0]['columns'] == []


def test_fallback_por_empresa_cuando_customerid_no_coincide(db):
    # Registrada con CU1; se lista con un customerId distinto (p. ej. desalineado por
    # el mapping template del Authorizer) pero MISMA empresa → el fallback la encuentra.
    reg, lst, _ = db
    _register(reg, customerId='CU1', customer='empresa')
    resp = lst.lambda_handler({'customerId': 'OTRO-ID', 'customer': 'empresa'}, None)
    assert resp['statusCode'] == 200
    assert len(resp['data']['files']) == 1  # la encontró por nombre de empresa


def test_sin_identificadores_400(db):
    _, lst, _ = db
    assert lst.lambda_handler({}, None)['statusCode'] == 400


def _new_id(reg, **kw):
    return _register(reg, **kw)['data']['databaseFileId']


def test_eliminar_base(db):
    reg, lst, delete = db
    bid = _new_id(reg)
    resp = delete.lambda_handler({'databaseFileId': bid}, None)
    assert resp['statusCode'] == 200
    # Ya no aparece en el listado.
    assert lst.lambda_handler({'customerId': 'CU1'}, None)['data']['count'] == 0


def test_eliminar_verifica_dueno(db):
    reg, _, delete = db
    bid = _new_id(reg, customerId='CU1', customer='empresa')
    # Otro cliente (por token) no puede borrarla.
    event = {'databaseFileId': bid, 'requestContext': {'authorizer': {'customerId': 'OTRO', 'customer': 'otra'}}}
    assert delete.lambda_handler(event, None)['statusCode'] == 403


def test_eliminar_inexistente_404(db):
    _, _, delete = db
    assert delete.lambda_handler({'databaseFileId': 'nope'}, None)['statusCode'] == 404


def test_eliminar_sin_id_400(db):
    _, _, delete = db
    assert delete.lambda_handler({}, None)['statusCode'] == 400
