"""
Pruebas de `Api_V1_Template_Create-template`.

El foco es el contrato que consume el constructor de correos: la respuesta debe traer el
**nombre FINAL en SES** (`{cliente}_{consecutivo}_{nombre}`). Sin ese dato el front no
puede emparejar la plantilla publicada con su diseño editable y "cargar" solo podría
devolver HTML crudo.
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
LAMBDA = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Template_Create-template' / 'lambda_function.py'


def _load():
    spec = importlib.util.spec_from_file_location('create_template_mod', str(LAMBDA))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _tabla(dynamodb, nombre, pk):
    dynamodb.create_table(
        TableName=nombre,
        KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


@pytest.fixture
def mod():
    with mock_aws():
        dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
        for nombre, pk in (('channel', 'channelId'), ('customer', 'customerId'),
                           ('templateControl', 'customerId'), ('templateAudit', 'templateAuditId'),
                           ('adminAudit', 'auditId')):
            _tabla(dynamodb, nombre, pk)
        dynamodb.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'Acme SAS'})
        dynamodb.Table('templateControl').put_item(Item={'customerId': 'CU1', 'consecutive': '0007'})
        yield _load()


def _evento(nombre='Boletin'):
    return {
        'userId': 'U1', 'customerId': 'CU1', 'channel': 1,
        'templateName': nombre, 'subject': 'Hola', 'htmlBody': '<p>hola</p>', 'textBody': 'hola',
        'requestContext': {'authorizer': {'customerId': 'CU1', 'user': 'a@b.co'}},
    }


def test_devuelve_el_nombre_final_en_ses(mod):
    """Es lo que el constructor guarda junto al diseño para dejarlos emparejados."""
    resp = mod.lambda_handler(_evento(), None)
    assert resp['statusCode'] == 201, resp
    nombre = resp['data']['templateName']
    # Convención {cliente}_{consecutivo}_{nombre}: la misma que busca Prepare-batch.
    assert nombre.startswith('AcmeSAS_') or nombre.startswith('Acme'), nombre
    assert nombre.endswith('_Boletin'), nombre
    # Y la plantilla existe DE VERDAD en SES con ese nombre exacto.
    ses = boto3.client('ses', region_name='us-east-1')
    assert ses.get_template(TemplateName=nombre)['Template']['TemplateName'] == nombre


def test_el_nombre_se_sanea_para_ses(mod):
    """SES solo acepta [A-Za-z0-9_-]: un nombre con acentos o espacios reventaba con 500."""
    resp = mod.lambda_handler(_evento('Promoción de Año Nuevo'), None)
    assert resp['statusCode'] == 201, resp
    nombre = resp['data']['templateName']
    assert all(c.isalnum() or c in '_-' for c in nombre), nombre


def test_error_no_deja_nombre_colgado(mod):
    """Si falla antes de crear en SES, `data.templateName` va vacío (no un nombre falso)."""
    evento = _evento()
    del evento['subject']
    resp = mod.lambda_handler(evento, None)
    assert resp['statusCode'] != 201
    assert resp['data']['templateName'] == ''
