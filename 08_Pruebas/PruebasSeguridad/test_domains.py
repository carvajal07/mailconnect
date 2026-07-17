"""
Pruebas de los dominios de envío del cliente (identidades SES por dominio):
  - Api_V1_Domain_Add / Api_V1_Domain_List / Api_V1_Domain_Delete
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
LAMBDAS = REPO_ROOT / '04_Backend' / 'lambdas'


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, str(LAMBDAS / rel / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def mods():
    with mock_aws():
        add = _load('dom_add', 'Api_V1_Domain_Add')
        lst = _load('dom_list', 'Api_V1_Domain_List')
        dele = _load('dom_del', 'Api_V1_Domain_Delete')
        yield add, lst, dele


def _auth(body, cid='CU1', customer='ACME'):
    return {**body, 'requestContext': {'authorizer': {'customerId': cid, 'customer': customer}}}


def test_add_devuelve_registros_dns(mods):
    add, _, _ = mods
    resp = add.lambda_handler(_auth({'domain': 'empresa.com'}), None)
    assert resp['statusCode'] == 201
    data = resp['data']
    assert data['domain'] == 'empresa.com' and data['status'] == 'pending'
    # 1 TXT de verificación + 3 CNAME DKIM.
    types = [r['type'] for r in data['records']]
    assert types.count('TXT') == 1 and types.count('CNAME') == 3
    assert any(r['name'] == '_amazonses.empresa.com' for r in data['records'])


def test_add_dominio_invalido_400(mods):
    add, _, _ = mods
    assert add.lambda_handler(_auth({'domain': 'no-es-dominio'}), None)['statusCode'] == 400


def test_add_dominio_plataforma_400(mods):
    add, _, _ = mods
    assert add.lambda_handler(_auth({'domain': 'mailconnect.com.co'}), None)['statusCode'] == 400


def test_add_sin_sesion_403(mods):
    add, _, _ = mods
    resp = add.lambda_handler({'domain': 'x.com', 'requestContext': {'authorizer': {}}}, None)
    assert resp['statusCode'] == 403


def test_add_duplicado_409(mods):
    add, _, _ = mods
    add.lambda_handler(_auth({'domain': 'dup.com'}), None)
    assert add.lambda_handler(_auth({'domain': 'dup.com'}), None)['statusCode'] == 409


def test_list_incluye_el_dominio(mods):
    add, lst, _ = mods
    add.lambda_handler(_auth({'domain': 'empresa.com'}), None)
    resp = lst.lambda_handler(_auth({}), None)
    assert resp['statusCode'] == 200
    domains = [d['domain'] for d in resp['data']['domains']]
    assert 'empresa.com' in domains


def test_list_otro_cliente_no_ve(mods):
    add, lst, _ = mods
    add.lambda_handler(_auth({'domain': 'empresa.com'}, cid='CU1'), None)
    resp = lst.lambda_handler(_auth({}, cid='CU2'), None)
    assert resp['statusCode'] == 200
    assert resp['data']['count'] == 0


def test_delete_ok_y_tenant(mods):
    add, lst, dele = mods
    r = add.lambda_handler(_auth({'domain': 'empresa.com'}), None)
    did = r['data']['domainId']
    # Otro cliente no puede borrarlo.
    assert dele.lambda_handler(_auth({'domainId': did}, cid='CU2'), None)['statusCode'] == 403
    # El dueño sí.
    assert dele.lambda_handler(_auth({'domainId': did}), None)['statusCode'] == 200
    assert lst.lambda_handler(_auth({}), None)['data']['count'] == 0


def test_delete_no_existe_404(mods):
    _, _, dele = mods
    # La tabla no existe aún → get_item falla; creamos un dominio primero para que exista.
    add = _load('dom_add2', 'Api_V1_Domain_Add')
    add.lambda_handler(_auth({'domain': 'otro.com'}), None)
    assert dele.lambda_handler(_auth({'domainId': 'NADA'}), None)['statusCode'] == 404
