"""
Pruebas de la configuración de IP de envío dedicada por cliente:
  - Api_V1_SendingConfig_{List,Set} (admin, 2ª barrera JWT, upsert/remove).
  - Prepare-batch.resolve_configuration_set + build_ctx llevan el config set correcto
    (el del cliente si tiene IP dedicada habilitada; el general si no).
"""
import importlib.util
import os
import sys
import types
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers_auth import make_token  # noqa: E402  (fija SECRET_KEY + firma JWT)

LAMBDAS = Path(__file__).resolve().parents[2] / '04_Backend' / 'lambdas'


def _load(folder, name):
    # pandas viene por layer en AWS; en pruebas se stubea (Prepare-batch lo importa).
    if 'pandas' not in sys.modules:
        sys.modules['pandas'] = types.ModuleType('pandas')
    spec = importlib.util.spec_from_file_location(name, str(LAMBDAS / folder / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _admin(body):
    return {**body, 'authToken': make_token(), 'requestContext': {'authorizer': {'role': 'admin'}}}


# ── Lambdas admin List/Set ────────────────────────────────────────────────────

@pytest.fixture
def cfg():
    with mock_aws():
        yield _load('Api_V1_SendingConfig_List', 'sc_list'), _load('Api_V1_SendingConfig_Set', 'sc_set')


def test_list_vacia_si_no_existe_tabla(cfg):
    lst, _ = cfg
    resp = lst.lambda_handler(_admin({}), None)
    assert resp['statusCode'] == 200
    assert resp['data']['configs'] == []


def test_set_crea_tabla_y_guarda(cfg):
    lst, st = cfg
    resp = st.lambda_handler(_admin({
        'customerId': 'CU1', 'configurationSet': 'mc-cu1', 'poolName': 'pool-cu1',
        'ips': ['1.2.3.4', '1.2.3.5'], 'enabled': True, 'notes': 'dedicada'}), None)
    assert resp['statusCode'] == 200
    assert resp['data']['configurationSet'] == 'mc-cu1'
    # Aparece en el listado.
    out = lst.lambda_handler(_admin({}), None)['data']['configs']
    assert len(out) == 1
    assert out[0]['customerId'] == 'CU1'
    assert out[0]['configurationSet'] == 'mc-cu1'
    assert out[0]['ips'] == ['1.2.3.4', '1.2.3.5']
    assert out[0]['enabled'] is True


def test_set_sin_configset_400(cfg):
    _, st = cfg
    assert st.lambda_handler(_admin({'customerId': 'CU1'}), None)['statusCode'] == 400


def test_set_sin_customerid_400(cfg):
    _, st = cfg
    assert st.lambda_handler(_admin({'configurationSet': 'x'}), None)['statusCode'] == 400


def test_set_remove_borra(cfg):
    lst, st = cfg
    st.lambda_handler(_admin({'customerId': 'CU1', 'configurationSet': 'mc-cu1'}), None)
    resp = st.lambda_handler(_admin({'customerId': 'CU1', 'remove': True}), None)
    assert resp['statusCode'] == 200 and resp['data']['removed'] is True
    assert lst.lambda_handler(_admin({}), None)['data']['configs'] == []


def test_set_enabled_string_false(cfg):
    lst, st = cfg
    st.lambda_handler(_admin({'customerId': 'CU2', 'configurationSet': 'mc-cu2', 'enabled': 'false'}), None)
    row = lst.lambda_handler(_admin({}), None)['data']['configs'][0]
    assert row['enabled'] is False


def test_admin_gate(cfg):
    lst, st = cfg
    # Context admin falsificado sin token válido → 403 (segunda barrera).
    assert lst.lambda_handler({'requestContext': {'authorizer': {'role': 'admin'}}}, None)['statusCode'] == 403
    assert st.lambda_handler({'customerId': 'X', 'configurationSet': 'y',
                              'requestContext': {'authorizer': {'role': 'admin'}}}, None)['statusCode'] == 403
    # Token de cliente (no admin) → 403.
    assert lst.lambda_handler({'authToken': make_token(role='client'),
                               'requestContext': {'authorizer': {'role': 'admin'}}}, None)['statusCode'] == 403


# ── Ruteo en Prepare-batch (resolve_configuration_set + build_ctx) ────────────

@pytest.fixture
def prep():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        ddb.create_table(TableName='sendingConfig',
                         KeySchema=[{'AttributeName': 'customerId', 'KeyType': 'HASH'}],
                         AttributeDefinitions=[{'AttributeName': 'customerId', 'AttributeType': 'S'}],
                         BillingMode='PAY_PER_REQUEST')
        yield _load('Api_V1_Email_Prepare-batch-template', 'prep_batch')


def test_resolve_config_set_default_si_no_configurado(prep):
    # Cliente sin fila → config set GENERAL (default).
    assert prep.resolve_configuration_set('CU_NONE') == prep.DEFAULT_CONFIGURATION_SET


def test_resolve_config_set_del_cliente_si_habilitado(prep):
    boto3.resource('dynamodb', region_name='us-east-1').Table('sendingConfig').put_item(
        Item={'customerId': 'CU1', 'configurationSet': 'mc-cu1', 'enabled': True})
    assert prep.resolve_configuration_set('CU1') == 'mc-cu1'


def test_resolve_config_set_deshabilitado_cae_al_general(prep):
    boto3.resource('dynamodb', region_name='us-east-1').Table('sendingConfig').put_item(
        Item={'customerId': 'CU2', 'configurationSet': 'mc-cu2', 'enabled': False})
    assert prep.resolve_configuration_set('CU2') == prep.DEFAULT_CONFIGURATION_SET


def test_build_ctx_incluye_config_set(prep):
    st = prep.ProcessState()
    st.customer_id = 'CU1'
    st.configuration_set = 'mc-cu1'
    ctx = prep.build_ctx(st)
    assert ctx['configurationSet'] == 'mc-cu1'
    # Y prepare_message lo propaga al mensaje SQS que leen los workers.
    import json as _json
    msg = _json.loads(prep.prepare_message(ctx, [['1', 'a@x.com', 'Ana']], 0))
    assert msg['configurationSet'] == 'mc-cu1'
