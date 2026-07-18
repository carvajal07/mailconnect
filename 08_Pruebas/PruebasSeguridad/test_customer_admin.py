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


def _admin(body):
    """Envuelve el body con el context de un Authorizer de rol admin."""
    return {**body, 'requestContext': {'authorizer': {'role': 'admin'}}}


def test_list_ordena_y_default_habilitado(cust):
    lst, _ = cust
    resp = lst.lambda_handler(_admin({}), None)
    assert resp['statusCode'] == 200
    customers = resp['data']['customers']
    # Orden alfabético por empresa: Alfa antes que Beta.
    assert [c['company'] for c in customers] == ['Alfa', 'Beta']
    # El que no tiene el campo se reporta habilitado (fail-open).
    alfa = next(c for c in customers if c['company'] == 'Alfa')
    assert alfa['realSendEnabled'] is True


def test_list_no_admin_403(cust):
    lst, _ = cust
    # Sin rol admin en el context → denegado.
    assert lst.lambda_handler({'requestContext': {'authorizer': {'role': 'client'}}}, None)['statusCode'] == 403
    assert lst.lambda_handler({}, None)['statusCode'] == 403


def test_update_deshabilita(cust):
    _, upd = cust
    resp = upd.lambda_handler(_admin({'customerId': 'CU1', 'realSendEnabled': False}), None)
    assert resp['statusCode'] == 200
    item = boto3.resource('dynamodb', region_name='us-east-1').Table('customer').get_item(Key={'customerId': 'CU1'})['Item']
    assert item['realSendEnabled'] is False


def test_update_no_admin_403(cust):
    _, upd = cust
    assert upd.lambda_handler({'customerId': 'CU1', 'realSendEnabled': False}, None)['statusCode'] == 403


def test_update_acepta_string(cust):
    _, upd = cust
    upd.lambda_handler(_admin({'customerId': 'CU2', 'realSendEnabled': 'false'}), None)
    item = boto3.resource('dynamodb', region_name='us-east-1').Table('customer').get_item(Key={'customerId': 'CU2'})['Item']
    assert item['realSendEnabled'] is False


def test_update_cliente_inexistente_404(cust):
    _, upd = cust
    assert upd.lambda_handler(_admin({'customerId': 'NOPE', 'realSendEnabled': True}), None)['statusCode'] == 404


def test_update_sin_datos_400(cust):
    _, upd = cust
    assert upd.lambda_handler(_admin({'customerId': 'CU1'}), None)['statusCode'] == 400


# --- Ficha de cliente (Customer/Detail) + cambio de rol (User/SetRole) --------------

def _pk_table(name, pk):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name,
        KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


@pytest.fixture
def ficha():
    with mock_aws():
        _pk_table('customer', 'customerId')
        _pk_table('user', 'userId')
        _pk_table('userData', 'userDataId')
        ddb = boto3.resource('dynamodb', region_name='us-east-1')
        ddb.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'Acme', 'companyTin': '900', 'realSendEnabled': True, 'date': '2026-01-01'})
        ddb.Table('userData').put_item(Item={'userDataId': 'D1', 'customerId': 'CU1', 'userName': 'Ana', 'phone': '+573001112233'})
        ddb.Table('userData').put_item(Item={'userDataId': 'D2', 'customerId': 'CU1', 'userName': 'Beto', 'phone': '+573004445566'})
        ddb.Table('user').put_item(Item={'userId': 'U1', 'userDataId': 'D1', 'customerId': 'CU1', 'email': 'ana@acme.co', 'role': 'admin', 'active': True})
        ddb.Table('user').put_item(Item={'userId': 'U2', 'userDataId': 'D2', 'customerId': 'CU1', 'email': 'beto@acme.co', 'role': 'client', 'active': True})
        ddb.Table('user').put_item(Item={'userId': 'U9', 'userDataId': 'D9', 'customerId': 'CU2', 'email': 'root@mc.co', 'role': 'admin', 'active': True})
        yield _load('Api_V1_Customer_Detail'), _load('Api_V1_User_SetRole')


def test_detail_requiere_admin(ficha):
    detail, _ = ficha
    resp = detail.lambda_handler({'requestContext': {'authorizer': {'role': 'client'}}, 'customerId': 'CU1'}, None)
    assert resp['statusCode'] == 403


def test_detail_une_usuarios_y_perfil(ficha):
    detail, _ = ficha
    resp = detail.lambda_handler(_admin({'customerId': 'CU1'}), None)
    assert resp['statusCode'] == 200
    assert resp['data']['customer']['company'] == 'Acme'
    assert resp['data']['count'] == 2
    ana = next(u for u in resp['data']['users'] if u['email'] == 'ana@acme.co')
    assert ana['name'] == 'Ana' and ana['role'] == 'admin' and ana['phone'] == '+573001112233'


def test_detail_404_si_no_existe(ficha):
    detail, _ = ficha
    assert detail.lambda_handler(_admin({'customerId': 'NOPE'}), None)['statusCode'] == 404


def test_setrole_promueve_client_a_admin(ficha):
    _, setrole = ficha
    resp = setrole.lambda_handler(_admin({'userId': 'U2', 'role': 'admin'}), None)
    assert resp['statusCode'] == 200 and resp['data']['role'] == 'admin'


def test_setrole_degrada_admin_a_client(ficha):
    _, setrole = ficha
    # U1 es admin pero hay otro admin (U9) → se permite degradar.
    resp = setrole.lambda_handler(_admin({'userId': 'U1', 'role': 'client'}), None)
    assert resp['statusCode'] == 200 and resp['data']['role'] == 'client'


def test_setrole_no_degrada_ultimo_admin(ficha):
    _, setrole = ficha
    # Degradar U9 deja a U1 como único admin; luego degradar U1 debe fallar (409).
    setrole.lambda_handler(_admin({'userId': 'U9', 'role': 'client'}), None)
    resp = setrole.lambda_handler(_admin({'userId': 'U1', 'role': 'client'}), None)
    assert resp['statusCode'] == 409


def test_setrole_rol_invalido_400(ficha):
    _, setrole = ficha
    assert setrole.lambda_handler(_admin({'userId': 'U1', 'role': 'superuser'}), None)['statusCode'] == 400


def test_setrole_usuario_inexistente_404(ficha):
    _, setrole = ficha
    assert setrole.lambda_handler(_admin({'userId': 'ZZZ', 'role': 'admin'}), None)['statusCode'] == 404


def test_setrole_requiere_admin(ficha):
    _, setrole = ficha
    resp = setrole.lambda_handler({'requestContext': {'authorizer': {'role': 'client'}}, 'userId': 'U2', 'role': 'admin'}, None)
    assert resp['statusCode'] == 403


# ───────────────────────── Customer/Delete ─────────────────────────

@pytest.fixture
def borrar():
    with mock_aws():
        _pk_table('customer', 'customerId')
        _pk_table('user', 'userId')
        _pk_table('userData', 'userDataId')
        ddb = boto3.resource('dynamodb', region_name='us-east-1')
        ddb.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'Acme', 'companyTin': '900'})
        ddb.Table('customer').put_item(Item={'customerId': 'CU2', 'company': 'Otra', 'companyTin': '901'})
        ddb.Table('userData').put_item(Item={'userDataId': 'D1', 'customerId': 'CU1', 'userName': 'Ana'})
        ddb.Table('user').put_item(Item={'userId': 'U1', 'userDataId': 'D1', 'customerId': 'CU1', 'email': 'ana@acme.co', 'role': 'admin'})
        ddb.Table('user').put_item(Item={'userId': 'U2', 'userDataId': 'D2', 'customerId': 'CU1', 'email': 'b@acme.co', 'role': 'client'})
        ddb.Table('user').put_item(Item={'userId': 'U9', 'customerId': 'CU2', 'email': 'root@otra.co', 'role': 'admin'})
        yield _load('Api_V1_Customer_Delete')


def _tbl(name):
    return boto3.resource('dynamodb', region_name='us-east-1').Table(name)


def test_delete_requiere_admin(borrar):
    resp = borrar.lambda_handler({'requestContext': {'authorizer': {'role': 'client'}}, 'customerId': 'CU1'}, None)
    assert resp['statusCode'] == 403


def test_delete_borra_cliente_y_sus_usuarios(borrar):
    resp = borrar.lambda_handler(_admin({'customerId': 'CU1'}), None)
    assert resp['statusCode'] == 200 and resp['data']['deletedUsers'] == 2
    # El cliente y sus usuarios ya no están.
    assert _tbl('customer').get_item(Key={'customerId': 'CU1'}).get('Item') is None
    assert _tbl('user').get_item(Key={'userId': 'U1'}).get('Item') is None
    assert _tbl('user').get_item(Key={'userId': 'U2'}).get('Item') is None
    # El usuario de OTRA empresa (CU2) NO se toca.
    assert _tbl('user').get_item(Key={'userId': 'U9'}).get('Item') is not None
    assert _tbl('customer').get_item(Key={'customerId': 'CU2'}).get('Item') is not None


def test_delete_404_si_no_existe(borrar):
    assert borrar.lambda_handler(_admin({'customerId': 'NOPE'}), None)['statusCode'] == 404


def test_delete_falta_id_400(borrar):
    assert borrar.lambda_handler(_admin({}), None)['statusCode'] == 400


def test_delete_no_permite_borrar_propia_empresa(borrar):
    # El admin actúa desde CU1 y trata de borrar CU1 → 400 (evita auto-bloqueo).
    event = {'customerId': 'CU1', 'requestContext': {'authorizer': {'role': 'admin', 'customerId': 'CU1'}}}
    resp = borrar.lambda_handler(event, None)
    assert resp['statusCode'] == 400
    assert _tbl('customer').get_item(Key={'customerId': 'CU1'}).get('Item') is not None
