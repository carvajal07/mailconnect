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
        yield module


def test_check_unsubscribes_encuentra_desuscritos(pb):
    keys = [{'email': 'baja@test.com'}, {'email': 'activo@test.com'}, {'email': 'baja2@test.com'}]
    result = pb.check_unsubscribes('empresa', keys)
    assert result == {'baja@test.com', 'baja2@test.com'}


def test_check_blacklist_encuentra_lista_negra(pb):
    keys = [{'email': 'negro@test.com'}, {'email': 'limpio@test.com'}]
    assert pb.check_blacklist('empresa', keys) == {'negro@test.com'}


def test_batch_get_dedup_y_troceo(pb):
    # 150 llaves con duplicados: no debe reventar por el límite de 100 de BatchGet.
    keys = [{'email': 'baja@test.com'}] * 3 + [{'email': f'x{i}@test.com'} for i in range(150)]
    result = pb._batch_get_emails('empresa_unsubscribe', keys)
    assert result == {'baja@test.com'}


def test_tabla_inexistente_no_revienta(pb):
    # ESTRUCTURAL (ResourceNotFound): si la tabla no existe, devuelve vacío (no hay entradas que
    # filtrar) en vez de tumbar el envío.
    assert pb._batch_get_emails('empresa_noexiste_unsubscribe', [{'email': 'a@test.com'}]) == set()


def test_filtro_error_transitorio_falla_cerrado(pb, monkeypatch):
    """FAIL-CLOSED (cumplimiento): un error TRANSITORIO (throttling) al consultar la lista negra
    NO devuelve vacío (que enviaría SIN filtrar a contactos que podrían estar excluidos) → se
    RE-LANZA para que la parte se reprocese. Antes cualquier error → vacío → envío a ciegas."""
    from botocore.exceptions import ClientError

    def _throttle(**kw):
        raise ClientError({'Error': {'Code': 'ProvisionedThroughputExceededException',
                                     'Message': 'throttled'}}, 'BatchGetItem')
    monkeypatch.setattr(pb.dynamodb, 'batch_get_item', _throttle)
    with pytest.raises(ClientError):
        pb._batch_get_emails('empresa_blackList', [{'email': 'x@test.com'}])
    # check_blacklist propaga (no traga) el error → el envío no continúa sin filtrar.
    with pytest.raises(ClientError):
        pb.check_blacklist('empresa', [{'email': 'x@test.com'}])


def test_worker_sqs_propaga_excepcion_no_ackea(pb, monkeypatch):
    """El branch SQS del handler debe PROPAGAR la excepción (fallar la invocación → SQS reprocesa
    y, tras reintentos, DLQ), en vez de devolver 200 y ACKear el mensaje (que perdería la parte)."""
    def _boom(_st, _job):
        raise RuntimeError('fallo simulado en procesar_parte')
    monkeypatch.setattr(pb, 'procesar_parte', _boom)
    with pytest.raises(RuntimeError):
        pb.lambda_handler({'Records': [{'body': json.dumps({'part': 1})}]}, None)


# ---- Fase 0: quick wins ----

def _ctx(**over):
    base = {'customerId': 'CU1', 'customerName': 'empresa', 'processId': 'P1',
            'campaignId': 'K1', 'attachment': False, 'fromEmail': 'a@b.com',
            'headers': ['Id', 'Correo', 'Nombre'], 'templateName': 'T',
            'smsBody': '', 'wspTemplate': '', 'voiceMessage': ''}
    base.update(over)
    return base


def test_prepare_message_es_pura_y_devuelve_json(pb):
    # Fase 3: prepare_message(ctx, data, part) ya NO lee globals; es pura y testeable.
    out = pb.prepare_message(_ctx(), [['1', 'a@b.com', 'Ana']], 3)
    parsed = json.loads(out)
    assert parsed['processId'] == 'P1'
    assert parsed['part'] == 3
    assert parsed['data'] == [['1', 'a@b.com', 'Ana']]
    assert parsed['smsBody'] == '' and parsed['voiceMessage'] == ''


def test_build_ctx_lee_el_estado_actual(pb):
    # build_ctx(st) ya no lee globals: arma el ctx desde el ProcessState de la invocación.
    st = pb.ProcessState()
    st.customer_id = 'CU9'; st.customer_name = 'empresa'; st.process_id = 'PZ'
    st.campaign_id = 'K9'; st.attachment = True; st.from_email = 'x@y.com'
    st.headers = ['a']; st.template_name = 'TT'
    st.sms_body = 'hola'; st.wsp_template = ''; st.voice_message = ''
    ctx = pb.build_ctx(st)
    assert ctx['customerId'] == 'CU9' and ctx['processId'] == 'PZ'
    assert ctx['smsBody'] == 'hola' and ctx['attachment'] is True


def test_classify_and_enqueue_filtra_y_agrupa(pb):
    # Núcleo del envío real extraído: clasifica y agrupa en lotes, con send_fn inyectado.
    enviados = []
    registers = [
        ['1', 'ok1@t.com', 'A'],
        ['2', 'negro@t.com', 'B'],   # lista negra
        ['3', 'ok2@t.com', 'C'],
        ['4', 'baja@t.com', 'D'],    # desuscrito
        ['5', 'ok3@t.com', 'E'],
    ]
    bl = pb.classify_and_enqueue(
        _ctx(), registers,
        blacklist_emails={'negro@t.com'}, unsubscribes_emails={'baja@t.com'},
        registers_for_message=2, url_sqs='q',
        send_fn=lambda url, msg: enviados.append(json.loads(msg)))
    registers_blacklist, registers_unsubscribe, enqueued, parts = bl
    assert len(registers_blacklist) == 1 and len(registers_unsubscribe) == 1
    assert enqueued == 3          # 3 válidos (ok1, ok2, ok3)
    assert parts == 2             # lotes de 2 → [2] + [1]
    # Los mensajes solo llevan los válidos, en orden.
    correos = [row[1] for m in enviados for row in m['data']]
    assert correos == ['ok1@t.com', 'ok2@t.com', 'ok3@t.com']


def test_classify_and_enqueue_part_offset_numera_unico(pb):
    # Fase 4: en el fan-out, cada part-file numera sus lotes con part_offset para que el
    # número de parte sea ÚNICO en todo el proceso (la lambda de envío deduplica por parte).
    enviados = []
    registers = [['1', 'a@t.com', 'A'], ['2', 'b@t.com', 'B'], ['3', 'c@t.com', 'C']]
    pb.classify_and_enqueue(
        _ctx(), registers, blacklist_emails=set(), unsubscribes_emails=set(),
        registers_for_message=1, url_sqs='q',
        send_fn=lambda url, msg: enviados.append(json.loads(msg)), part_offset=5000)
    assert [m['part'] for m in enviados] == [5001, 5002, 5003]


def test_send_sqs_propaga_error(pb):
    # Antes se tragaba la excepción (print) → el envío quedaba "Enviando" sin encolar.
    # Ahora el error se PROPAGA para que el bloque que llama marque Error.
    import pytest as _pytest
    with _pytest.raises(Exception):
        pb.send_sqs('https://sqs.us-east-1.amazonaws.com/000000000000/cola-inexistente', 'x')


def test_search_samples_eliminado(pb):
    # Código muerto y con bugs: ya no debe existir.
    assert not hasattr(pb, 'search_samples')
