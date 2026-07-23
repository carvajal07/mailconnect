"""
Gestión de EQUIPO por el dueño (owner): Api_V1_User_{Create,List,Delete}.
El dueño crea usuarios de SU empresa (operator/approver), con tope de 2 sin contar al owner,
solo el owner puede, y no puede eliminar a un owner ni a sí mismo.
"""
import importlib.util
import os
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

LAMBDAS = Path(__file__).resolve().parents[2] / '04_Backend' / 'lambdas'
CID = 'CU1'
OWNER = 'owner-1'


def _load(name, folder):
    spec = importlib.util.spec_from_file_location(name, str(LAMBDAS / folder / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _mk(ddb, name, pk):
    ddb.create_table(TableName=name, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
                     AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
                     BillingMode='PAY_PER_REQUEST')


@pytest.fixture
def team():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        _mk(ddb, 'user', 'userId')
        _mk(ddb, 'userData', 'userDataId')
        _mk(ddb, 'adminAudit', 'auditId')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        # El owner ya existe (creado al registrarse la empresa).
        res.Table('user').put_item(Item={'userId': OWNER, 'customerId': CID, 'email': 'jefe@x.com',
                                          'tenantRole': 'owner', 'active': True, 'userDataId': 'ud-owner'})
        yield {'create': _load('u_create', 'Api_V1_User_Create'),
               'list': _load('u_list', 'Api_V1_User_List'),
               'delete': _load('u_delete', 'Api_V1_User_Delete'), 'res': res}


def _ctx(role='owner', cid=CID, uid=OWNER):
    return {'requestContext': {'authorizer': {'customerId': cid, 'customer': 'empresa',
                                              'nit': '900', 'userId': uid, 'tenantRole': role}}}


def _create(team, name, email, role='operator', **ctx):
    return team['create'].lambda_handler({'name': name, 'email': email, 'tenantRole': role, **_ctx(**ctx)}, None)


def test_owner_crea_usuario(team):
    resp = _create(team, 'Ana', 'ana@x.com', 'operator')
    assert resp['statusCode'] == 201
    uid = resp['data']['userId']
    it = team['res'].Table('user').get_item(Key={'userId': uid})['Item']
    assert it['customerId'] == CID and it['tenantRole'] == 'operator' and it['active'] is True
    # Contraseña no usable + marca para definirla.
    assert it['mustSetPassword'] is True


def test_no_owner_no_puede_crear(team):
    ev = {'name': 'X', 'email': 'x@x.com', 'tenantRole': 'operator', **_ctx(role='operator')}
    assert team['create'].lambda_handler(ev, None)['statusCode'] == 403


def test_rol_invalido_400(team):
    assert _create(team, 'X', 'x@x.com', role='owner')['statusCode'] == 400  # no se permite crear owners


def test_email_duplicado_409(team):
    _create(team, 'Ana', 'ana@x.com')
    assert _create(team, 'Otra', 'ana@x.com')['statusCode'] == 409


def test_tope_dos_usuarios(team):
    assert _create(team, 'A', 'a@x.com', 'operator')['statusCode'] == 201
    assert _create(team, 'B', 'b@x.com', 'approver')['statusCode'] == 201
    # El tercero (además del owner) se rechaza.
    assert _create(team, 'C', 'c@x.com', 'operator')['statusCode'] == 409


def test_list_incluye_owner_y_flags(team):
    _create(team, 'Ana', 'ana@x.com', 'operator')
    resp = team['list'].lambda_handler(_ctx(), None)
    assert resp['statusCode'] == 200
    users = resp['data']['users']
    assert any(u['isOwner'] for u in users)
    assert resp['data']['max'] == 2
    assert resp['data']['canAdd'] is True     # solo 1 de 2
    assert len(users) == 2


def test_delete_usuario(team):
    uid = _create(team, 'Ana', 'ana@x.com')['data']['userId']
    resp = team['delete'].lambda_handler({'userId': uid, **_ctx()}, None)
    assert resp['statusCode'] == 200
    assert 'Item' not in team['res'].Table('user').get_item(Key={'userId': uid})


def test_no_borra_owner(team):
    assert team['delete'].lambda_handler({'userId': OWNER, **_ctx()}, None)['statusCode'] == 409


def test_no_borra_de_otra_empresa(team):
    team['res'].Table('user').put_item(Item={'userId': 'foreign', 'customerId': 'CU2',
                                             'tenantRole': 'operator', 'email': 'z@z.com'})
    assert team['delete'].lambda_handler({'userId': 'foreign', **_ctx()}, None)['statusCode'] == 403


def test_no_owner_no_lista(team):
    assert team['list'].lambda_handler(_ctx(role='operator'), None)['statusCode'] == 403
