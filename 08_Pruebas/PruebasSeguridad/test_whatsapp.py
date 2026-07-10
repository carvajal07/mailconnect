"""
Pruebas de la lambda de envío WhatsApp (Api_V1_Wsp_Send-batch).

El cliente de AWS End User Messaging Social (socialmessaging) se mockea (moto no lo
cubre). Se verifica el armado del mensaje de plantilla (HSM), los parámetros del cuerpo
tomados del CSV (row[2:]) y el registro de estados en {customer}_sendStatus_{proceso}
tanto en éxito como en fallo.
"""
import os
import json
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
WSP_PATH = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Wsp_Send-batch' / 'lambda_function.py'


def _load():
    spec = importlib.util.spec_from_file_location('wsp_mod', str(WSP_PATH))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _event(customer, process_id, template, data):
    return {'Records': [{'body': json.dumps({
        'customerName': customer, 'processId': process_id,
        'headers': ['Identificacion', 'Celular', 'Nombre'],
        'wspTemplate': template, 'data': data,
    })}]}


@pytest.fixture
def wsp():
    with mock_aws():
        boto3.client('dynamodb', region_name='us-east-1').create_table(
            TableName='empresa_sendStatus_P1',
            KeySchema=[{'AttributeName': 'sendStatusId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'sendStatusId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        yield _load()


def _status_items():
    return boto3.resource('dynamodb', region_name='us-east-1').Table('empresa_sendStatus_P1').scan()['Items']


def test_wsp_envia_y_registra_estado(wsp, monkeypatch):
    enviados = []
    monkeypatch.setattr(wsp, 'ORIGINATION_PHONE_NUMBER_ID', 'phone-id-demo')
    monkeypatch.setattr(wsp.social, 'send_whatsapp_message',
                        lambda **kw: enviados.append(kw) or {'messageId': 'WAMID-1'})

    data = [['100', '+573001112233', 'Ana', 'Premium'], ['200', '+573004445566', 'Luis', 'Básico']]
    wsp.lambda_handler(_event('empresa', 'P1', 'promo_julio', data), None)

    # Se envió a los 2 destinatarios con la plantilla y los parámetros del CSV (row[2:]).
    assert len(enviados) == 2
    msg0 = json.loads(enviados[0]['message'].decode('utf-8'))
    assert msg0['to'] == '573001112233'  # sin el '+'
    assert msg0['template']['name'] == 'promo_julio'
    params = [p['text'] for p in msg0['template']['components'][0]['parameters']]
    assert params == ['Ana', 'Premium']

    items = _status_items()
    assert len(items) == 2
    assert all(int(i['state']) == 1 for i in items)  # enviado


def test_wsp_sin_numero_origen_marca_rechazado(wsp, monkeypatch):
    monkeypatch.setattr(wsp, 'ORIGINATION_PHONE_NUMBER_ID', '')  # sin origen configurado
    wsp.lambda_handler(_event('empresa', 'P1', 'promo_julio', [['1', '+573001112233', 'Ana']]), None)
    items = _status_items()
    assert len(items) == 1
    assert int(items[0]['state']) == 3  # rechazado


def test_wsp_sin_plantilla_marca_rechazado(wsp, monkeypatch):
    monkeypatch.setattr(wsp, 'ORIGINATION_PHONE_NUMBER_ID', 'phone-id-demo')
    monkeypatch.setattr(wsp.social, 'send_whatsapp_message', lambda **kw: {'messageId': 'X'})
    wsp.lambda_handler(_event('empresa', 'P1', '', [['1', '+573001112233', 'Ana']]), None)
    items = _status_items()
    assert len(items) == 1
    assert int(items[0]['state']) == 3  # rechazado: la campaña no trae plantilla HSM


def test_build_whatsapp_message_sin_params(wsp):
    # Sin parámetros de cuerpo no debe incluir 'components'.
    msg = wsp.build_whatsapp_message('+573001112233', 'bienvenida', [])
    assert 'components' not in msg['template']
    assert msg['to'] == '573001112233'
    assert msg['type'] == 'template'
