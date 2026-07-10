"""
Pruebas de las funciones de filtrado de Prepare-batch-template (desuscritos / lista
negra), que era donde estaba el bug del chequeo muerto.

No se ejercita el lambda_handler completo (descarga de S3, SQS, lectura de CSV con
pandas): eso requiere todo el arnés de envío. Se prueban las funciones puras que se
corrigieron, con moto para DynamoDB. `pandas` se stubea porque en AWS viene por layer
y no está instalado en CI.
"""
import os
import sys
import json
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
    # pandas viene por layer en AWS; en pruebas lo stubeamos (las funciones que
    # probamos no lo usan).
    if 'pandas' not in sys.modules:
        sys.modules['pandas'] = types.ModuleType('pandas')
    spec = importlib.util.spec_from_file_location('pb_mod', str(PB_PATH))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def pb():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')

        def mk(name):
            ddb.create_table(
                TableName=name, KeySchema=[{'AttributeName': 'email', 'KeyType': 'HASH'}],
                AttributeDefinitions=[{'AttributeName': 'email', 'AttributeType': 'S'}],
                BillingMode='PAY_PER_REQUEST')

        mk('empresa_unsubscribe')
        mk('empresa_blackList')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('empresa_unsubscribe').put_item(Item={'email': 'baja@test.com'})
        res.Table('empresa_unsubscribe').put_item(Item={'email': 'baja2@test.com'})
        res.Table('empresa_blackList').put_item(Item={'email': 'negro@test.com'})

        module = _load_prepare_batch()
        module.customer_name = 'empresa'  # global que usan check_unsubscribes/blacklist
        yield module


def test_check_unsubscribes_encuentra_desuscritos(pb):
    keys = [{'email': 'baja@test.com'}, {'email': 'activo@test.com'}, {'email': 'baja2@test.com'}]
    result = pb.check_unsubscribes(keys)
    assert result == {'baja@test.com', 'baja2@test.com'}


def test_check_blacklist_encuentra_lista_negra(pb):
    keys = [{'email': 'negro@test.com'}, {'email': 'limpio@test.com'}]
    assert pb.check_blacklist(keys) == {'negro@test.com'}


def test_batch_get_dedup_y_troceo(pb):
    # 150 llaves con duplicados: no debe reventar por el límite de 100 de BatchGet.
    keys = [{'email': 'baja@test.com'}] * 3 + [{'email': f'x{i}@test.com'} for i in range(150)]
    result = pb._batch_get_emails('empresa_unsubscribe', keys)
    assert result == {'baja@test.com'}


def test_tabla_inexistente_no_revienta(pb):
    # Si la tabla no existe, devuelve vacío en vez de tumbar el envío.
    assert pb._batch_get_emails('empresa_noexiste_unsubscribe', [{'email': 'a@test.com'}]) == set()


# ---- Fase 0: quick wins ----

def test_prepare_message_devuelve_json_valido(pb):
    # Antes: si el dict fallaba, json_string quedaba sin asignar → UnboundLocalError.
    # Ahora siempre devuelve un JSON válido con la data y la parte.
    pb.customer_id = 'CU1'; pb.customer_name = 'empresa'; pb.process_id = 'P1'
    pb.campaign_id = 'K1'; pb.attachment = False; pb.from_email = 'a@b.com'
    pb.headers = ['Id', 'Correo', 'Nombre']; pb.template_name = 'T'
    pb.sms_body = ''; pb.wsp_template = ''; pb.voice_message = ''
    out = pb.prepare_message([['1', 'a@b.com', 'Ana']], 3)
    parsed = json.loads(out)
    assert parsed['processId'] == 'P1'
    assert parsed['part'] == 3
    assert parsed['data'] == [['1', 'a@b.com', 'Ana']]


def test_send_sqs_propaga_error(pb):
    # Antes se tragaba la excepción (print) → el envío quedaba "Enviando" sin encolar.
    # Ahora el error se PROPAGA para que el bloque que llama marque Error.
    import pytest as _pytest
    with _pytest.raises(Exception):
        pb.send_sqs('https://sqs.us-east-1.amazonaws.com/000000000000/cola-inexistente', 'x')


def test_search_samples_eliminado(pb):
    # Código muerto y con bugs: ya no debe existir.
    assert not hasattr(pb, 'search_samples')
