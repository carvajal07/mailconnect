"""
Pruebas de las plantillas de mensaje multicanal (SMS / WSP / DOCX):
Create, List (filtro por canal + tenant) y Delete (verifica dueño).
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
    spec = importlib.util.spec_from_file_location('mt_' + folder, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def mt():
    with mock_aws():
        boto3.client('dynamodb', region_name='us-east-1').create_table(
            TableName='messageTemplate',
            KeySchema=[{'AttributeName': 'messageTemplateId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'messageTemplateId', 'AttributeType': 'S'},
                                  {'AttributeName': 'customerId', 'AttributeType': 'S'}],
            GlobalSecondaryIndexes=[{
                'IndexName': 'customerId-index',
                'KeySchema': [{'AttributeName': 'customerId', 'KeyType': 'HASH'}],
                'Projection': {'ProjectionType': 'ALL'}}],
            BillingMode='PAY_PER_REQUEST')
        yield _load('Api_V1_MessageTemplate_Create'), _load('Api_V1_MessageTemplate_List'), _load('Api_V1_MessageTemplate_Delete')


def _ctx(body, cid='CU1', cust='empresa'):
    """Inyecta requestContext.authorizer (el tenant SIEMPRE sale del token)."""
    return {**body, 'requestContext': {'authorizer': {'customerId': cid, 'customer': cust}}}


def test_create_sms(mt):
    create, _, _ = mt
    resp = create.lambda_handler(_ctx({'channel': 'SMS', 'name': 'Promo', 'body': 'Hola {{Nombre}}'}), None)
    assert resp['statusCode'] == 201
    assert resp['data']['messageTemplateId']


def test_create_sms_sin_body_400(mt):
    create, _, _ = mt
    assert create.lambda_handler(_ctx({'channel': 'SMS', 'name': 'X'}), None)['statusCode'] == 400


def test_create_wsp_requiere_hsm(mt):
    create, _, _ = mt
    assert create.lambda_handler(_ctx({'channel': 'WSP', 'name': 'X'}), None)['statusCode'] == 400
    ok = create.lambda_handler(_ctx({'channel': 'WSP', 'name': 'Bienvenida', 'hsmName': 'welcome', 'language': 'es', 'params': ['Nombre']}), None)
    assert ok['statusCode'] == 201


def test_create_docx_requiere_s3path(mt):
    create, _, _ = mt
    assert create.lambda_handler(_ctx({'channel': 'DOCX', 'name': 'X'}), None)['statusCode'] == 400
    ok = create.lambda_handler(_ctx({'channel': 'DOCX', 'name': 'Carta', 's3Path': 'docs/carta.docx', 'params': ['Nombre', 'Valor']}), None)
    assert ok['statusCode'] == 201


def test_create_channel_invalido_400(mt):
    create, _, _ = mt
    assert create.lambda_handler(_ctx({'channel': 'EMAIL', 'name': 'X'}), None)['statusCode'] == 400


def test_upsert_editar_conserva_id_y_actualiza(mt):
    # Editar = Create con messageTemplateId: MISMO id, 200 (no 201), campos actualizados,
    # y la fecha de creación original se conserva.
    create, lst, _ = mt
    creado = create.lambda_handler(_ctx({'channel': 'SMS', 'name': 'Promo', 'body': 'Hola'}), None)
    assert creado['statusCode'] == 201
    tid = creado['data']['messageTemplateId']

    editado = create.lambda_handler(_ctx({'channel': 'SMS', 'name': 'Promo v2', 'body': 'Hola {{Nombre}}', 'messageTemplateId': tid}), None)
    assert editado['statusCode'] == 200
    assert editado['data']['messageTemplateId'] == tid

    # No se duplicó: sigue habiendo UNA plantilla, con los datos nuevos.
    items = lst.lambda_handler(_ctx({}), None)['data']['templates']
    assert len(items) == 1
    assert items[0]['name'] == 'Promo v2'
    assert items[0]['body'] == 'Hola {{Nombre}}'


def test_list_filtra_por_canal_y_tenant(mt):
    create, lst, _ = mt
    create.lambda_handler(_ctx({'channel': 'SMS', 'name': 'A', 'body': 'x'}), None)
    create.lambda_handler(_ctx({'channel': 'WSP', 'name': 'B', 'hsmName': 'h'}), None)
    create.lambda_handler(_ctx({'channel': 'SMS', 'name': 'C', 'body': 'x'}, cid='CU2', cust='otra'), None)

    # Todas las de CU1
    resp = lst.lambda_handler(_ctx({}), None)
    assert resp['data']['count'] == 2
    # Solo SMS de CU1
    resp_sms = lst.lambda_handler(_ctx({'channel': 'SMS'}), None)
    assert [t['name'] for t in resp_sms['data']['templates']] == ['A']


def test_list_tenant_del_authorizer_manda(mt):
    create, lst, _ = mt
    create.lambda_handler(_ctx({'channel': 'SMS', 'name': 'A', 'body': 'x'}), None)
    # El body dice CU2 pero el token dice CU1 → gana el token.
    event = {'body': None, 'requestContext': {'authorizer': {'customerId': 'CU1'}}, 'customerId': 'CU2'}
    resp = lst.lambda_handler(event, None)
    assert resp['data']['count'] == 1


def test_delete_verifica_dueno(mt):
    create, _, delete = mt
    tid = create.lambda_handler(_ctx({'channel': 'SMS', 'name': 'A', 'body': 'x'}), None)['data']['messageTemplateId']
    # Otro cliente no puede borrarla.
    forbidden = delete.lambda_handler({'messageTemplateId': tid, 'requestContext': {'authorizer': {'customerId': 'CU2'}}}, None)
    assert forbidden['statusCode'] == 403
    # El dueño sí.
    ok = delete.lambda_handler({'messageTemplateId': tid, 'requestContext': {'authorizer': {'customerId': 'CU1'}}}, None)
    assert ok['statusCode'] == 200


def test_delete_inexistente_404(mt):
    _, _, delete = mt
    assert delete.lambda_handler(_ctx({'messageTemplateId': 'nope'}), None)['statusCode'] == 404
