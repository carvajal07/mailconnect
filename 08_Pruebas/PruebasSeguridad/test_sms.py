"""
Pruebas de la lambda de envío SMS (Api_V1_Sms_Send-batch).

El cliente de AWS End User Messaging (pinpoint-sms-voice-v2) se mockea (moto no lo
cubre del todo). Se verifica la personalización del texto y el registro de estados
en {customer}_sendStatus_{proceso} tanto en éxito como en fallo.
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
SMS_PATH = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Sms_Send-batch' / 'lambda_function.py'


def _load():
    spec = importlib.util.spec_from_file_location('sms_mod', str(SMS_PATH))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _event(customer, process_id, body_text, data):
    return {'Records': [{'body': json.dumps({
        'customerName': customer, 'processId': process_id,
        'headers': ['Identificacion', 'Celular', 'Nombre'],
        'smsBody': body_text, 'data': data,
    })}]}


@pytest.fixture
def sms():
    with mock_aws():
        boto3.client('dynamodb', region_name='us-east-1').create_table(
            TableName='empresa_sendStatus_P1',
            KeySchema=[{'AttributeName': 'sendStatusId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'sendStatusId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        yield _load()


def _status_items():
    return boto3.resource('dynamodb', region_name='us-east-1').Table('empresa_sendStatus_P1').scan()['Items']


def test_sms_envia_y_registra_estado(sms, monkeypatch):
    enviados = []
    monkeypatch.setattr(sms, 'ORIGINATION_IDENTITY', 'sender-demo')
    monkeypatch.setattr(sms.sms, 'send_text_message',
                        lambda **kw: enviados.append(kw) or {'MessageId': 'MID-1'})

    data = [['100', '+573001112233', 'Ana'], ['200', '+573004445566', 'Luis']]
    sms.lambda_handler(_event('empresa', 'P1', 'Hola {{Nombre}}, promo!', data), None)

    # Se personalizó el texto por destinatario
    cuerpos = [k['MessageBody'] for k in enviados]
    assert 'Hola Ana, promo!' in cuerpos and 'Hola Luis, promo!' in cuerpos
    # Se registraron 2 estados en estado 1 (enviado)
    items = _status_items()
    assert len(items) == 2
    assert all(int(i['state']) == 1 for i in items)


def test_sms_sin_identidad_marca_rechazado(sms, monkeypatch):
    monkeypatch.setattr(sms, 'ORIGINATION_IDENTITY', '')  # sin origen configurado
    sms.lambda_handler(_event('empresa', 'P1', 'x', [['1', '+573001112233', 'Ana']]), None)
    items = _status_items()
    assert len(items) == 1
    assert int(items[0]['state']) == 3  # rechazado


def test_personalize(sms):
    out = sms._personalize('Hola {{Nombre}} ({{Celular}})', ['Id', 'Celular', 'Nombre'], ['1', '+57300', 'Ana'])
    assert out == 'Hola Ana (+57300)'
