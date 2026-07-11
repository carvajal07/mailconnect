"""
Pruebas de los helpers de Prepare-batch para:
 - el límite de envíos de muestras por campaña (increment_samples_count).
 - el bloqueo de envíos reales por cliente (is_real_send_enabled).

Se prueban las funciones puras (con moto para DynamoDB), no el handler completo
(que requiere S3/SQS/CSV). `pandas` se stubea (viene por layer en AWS).
"""
import os
import sys
import types
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
PB_PATH = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Email_Prepare-batch-template' / 'lambda_function.py'


def _load_prepare_batch():
    if 'pandas' not in sys.modules:
        sys.modules['pandas'] = types.ModuleType('pandas')
    spec = importlib.util.spec_from_file_location('pb_limite_mod', str(PB_PATH))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def pb():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        ddb.create_table(
            TableName='campaign',
            KeySchema=[{'AttributeName': 'campaignId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'campaignId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        ddb.create_table(
            TableName='customer',
            KeySchema=[{'AttributeName': 'customerId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'customerId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('campaign').put_item(Item={'campaignId': 'C1', 'campaignName': 'Promo'})
        yield _load_prepare_batch()


def _set_state(state):
    boto3.resource('dynamodb', region_name='us-east-1').Table('campaign').update_item(
        Key={'campaignId': 'C1'},
        UpdateExpression='SET campaignState = :s',
        ExpressionAttributeValues={':s': state})


def _get_campaign():
    return boto3.resource('dynamodb', region_name='us-east-1').Table('campaign').get_item(
        Key={'campaignId': 'C1'})['Item']


def _st(pb, campaign_id='C1'):
    """Estado de invocación (antes eran globals) con el campaign_id seteado."""
    st = pb.ProcessState()
    st.campaign_id = campaign_id
    return st


def test_idempotencia_primer_envio_gana_el_lock(pb):
    _set_state('Pendiente')
    assert pb.try_start_real_send(_st(pb), 'PROC-1') is True
    item = _get_campaign()
    assert item['campaignState'] == 'Enviando'
    assert item['sendProcessId'] == 'PROC-1'


def test_idempotencia_reintento_no_reencola(pb):
    _set_state('Pendiente')
    assert pb.try_start_real_send(_st(pb), 'PROC-1') is True
    # Segundo intento (ya 'Enviando') → pierde el lock, no re-encola.
    assert pb.try_start_real_send(_st(pb), 'PROC-2') is False
    # El sendProcessId sigue siendo el del ganador.
    assert _get_campaign()['sendProcessId'] == 'PROC-1'


def test_idempotencia_terminada_no_reenvia(pb):
    _set_state('Terminada')
    assert pb.try_start_real_send(_st(pb), 'PROC-3') is False


def test_idempotencia_error_permite_reintento(pb):
    # Tras un fallo (Error), sí se permite reintentar el envío.
    _set_state('Error')
    assert pb.try_start_real_send(_st(pb), 'PROC-4') is True
    assert _get_campaign()['campaignState'] == 'Enviando'


def test_increment_samples_count_sube_de_a_uno(pb):
    st = _st(pb)
    assert pb.increment_samples_count(st) == 1
    assert pb.increment_samples_count(st) == 2
    assert pb.increment_samples_count(st) == 3


def test_max_sample_sends_es_cinco(pb):
    # El límite documentado/al front debe ser 5.
    assert pb.MAX_SAMPLE_SENDS == 5


def test_real_send_habilitado_por_defecto_si_falta_campo(pb):
    res = boto3.resource('dynamodb', region_name='us-east-1')
    res.Table('customer').put_item(Item={'customerId': 'CU-old', 'company': 'empresa'})
    assert pb.is_real_send_enabled('CU-old') is True  # fail-open


def test_real_send_deshabilitado(pb):
    res = boto3.resource('dynamodb', region_name='us-east-1')
    res.Table('customer').put_item(Item={'customerId': 'CU-off', 'company': 'x', 'realSendEnabled': False})
    assert pb.is_real_send_enabled('CU-off') is False


def test_real_send_habilitado_explicito(pb):
    res = boto3.resource('dynamodb', region_name='us-east-1')
    res.Table('customer').put_item(Item={'customerId': 'CU-on', 'company': 'x', 'realSendEnabled': True})
    assert pb.is_real_send_enabled('CU-on') is True
