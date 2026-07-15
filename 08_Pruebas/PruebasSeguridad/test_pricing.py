"""
Pruebas de las tarifas admin (pricingRate): Pricing/List y Pricing/Update.
Cubre: gating por rol admin, defaults sin tabla, override global y por cliente,
COMMON que escribe en los 4 canales, y consistencia con el estimador.
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
    spec = importlib.util.spec_from_file_location('pr_' + folder, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _admin(payload):
    return {'body': None, 'requestContext': {'authorizer': {'role': 'admin'}}, **payload}


def _create_table():
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName='pricingRate',
        KeySchema=[
            {'AttributeName': 'customerId', 'KeyType': 'HASH'},
            {'AttributeName': 'channel', 'KeyType': 'RANGE'},
        ],
        AttributeDefinitions=[
            {'AttributeName': 'customerId', 'AttributeType': 'S'},
            {'AttributeName': 'channel', 'AttributeType': 'S'},
        ],
        BillingMode='PAY_PER_REQUEST')


@pytest.fixture
def pr():
    with mock_aws():
        _create_table()
        yield _load('Api_V1_Pricing_List'), _load('Api_V1_Pricing_Update')


def test_list_requiere_admin(pr):
    lst, _ = pr
    resp = lst.lambda_handler({'requestContext': {'authorizer': {'role': 'client'}}, 'customerId': '*'}, None)
    assert resp['statusCode'] == 403


def test_update_requiere_admin(pr):
    _, upd = pr
    resp = upd.lambda_handler({'requestContext': {'authorizer': {'role': 'client'}},
                               'channel': 'SMS', 'fields': {'baseSms': 99}}, None)
    assert resp['statusCode'] == 403


def test_list_defaults_sin_overrides(pr):
    lst, _ = pr
    resp = lst.lambda_handler(_admin({'customerId': '*'}), None)
    assert resp['statusCode'] == 200
    data = resp['data']
    # Sin nada guardado, effective == defaults y overrides vacío.
    assert data['effective']['SMS']['baseSms'] == 60
    assert data['effective']['EMAIL']['baseEM'] == 8
    assert data['overrides']['SMS'] == {}


def test_update_global_y_list_lo_refleja(pr):
    lst, upd = pr
    assert upd.lambda_handler(_admin({'customerId': '*', 'channel': 'SMS', 'fields': {'baseSms': 75}}), None)['statusCode'] == 200
    resp = lst.lambda_handler(_admin({'customerId': '*'}), None)
    assert resp['data']['effective']['SMS']['baseSms'] == 75
    assert resp['data']['overrides']['SMS']['baseSms'] == 75


def test_override_cliente_gana_sobre_global(pr):
    lst, upd = pr
    upd.lambda_handler(_admin({'customerId': '*', 'channel': 'WHATSAPP', 'fields': {'baseMarketing': 90}}), None)
    upd.lambda_handler(_admin({'customerId': 'CU9', 'channel': 'WHATSAPP', 'fields': {'baseMarketing': 50}}), None)
    resp = lst.lambda_handler(_admin({'customerId': 'CU9'}), None)
    # El cliente hereda todo lo global salvo lo suyo (baseMarketing 50, no 90).
    assert resp['data']['effective']['WHATSAPP']['baseMarketing'] == 50
    assert resp['data']['overrides']['WHATSAPP']['baseMarketing'] == 50
    # Un campo no tocado por el cliente NO aparece en sus overrides.
    assert 'baseMarketing' in resp['data']['overrides']['WHATSAPP']


def test_common_escribe_en_los_cuatro_canales(pr):
    lst, upd = pr
    assert upd.lambda_handler(_admin({'customerId': '*', 'channel': 'COMMON',
                                      'fields': {'taxRate': 0.05, 'minCampaign': 1000}}), None)['statusCode'] == 200
    resp = lst.lambda_handler(_admin({'customerId': '*'}), None)
    for ch in ('EMAIL', 'SMS', 'WHATSAPP', 'VOICE'):
        assert resp['data']['effective'][ch]['taxRate'] == 0.05
        assert resp['data']['effective'][ch]['minCampaign'] == 1000


def test_update_channel_invalido_400(pr):
    _, upd = pr
    assert upd.lambda_handler(_admin({'channel': 'EMAILX', 'fields': {'x': 1}}), None)['statusCode'] == 400


def test_update_campo_no_permitido_se_ignora_400(pr):
    _, upd = pr
    # Solo campos no permitidos → no hay nada válido que escribir → 400.
    assert upd.lambda_handler(_admin({'channel': 'SMS', 'fields': {'hackerField': 1}}), None)['statusCode'] == 400


def test_mapping_template_body_como_objeto(pr):
    # Simula el evento que arma el mapping template no-proxy: body como OBJETO dict
    # + requestContext.authorizer con el rol. _get_payload debe leer ese body.
    lst, upd = pr
    event_update = {
        'body': {'customerId': '*', 'channel': 'SMS', 'fields': {'baseSms': 88}},
        'requestContext': {'authorizer': {'role': 'admin'}},
    }
    assert upd.lambda_handler(event_update, None)['statusCode'] == 200
    event_list = {'body': {'customerId': '*'}, 'requestContext': {'authorizer': {'role': 'admin'}}}
    resp = lst.lambda_handler(event_list, None)
    assert resp['statusCode'] == 200
    assert resp['data']['effective']['SMS']['baseSms'] == 88


def test_estimador_usa_la_tarifa_guardada(pr):
    _, upd = pr
    # Guardar una tarifa y comprobar que el estimador la lee (misma tabla).
    upd.lambda_handler(_admin({'customerId': '*', 'channel': 'SMS', 'fields': {'baseSms': 100}}), None)
    est = _load('Api_V1_Cost_Estimate')
    resp = est.lambda_handler({'channel': 'SMS', 'recipients': 10}, None)
    assert resp['statusCode'] == 200
    # unitCost = baseSms(100) × 1 segmento.
    assert resp['data']['unitCost'] == 100
