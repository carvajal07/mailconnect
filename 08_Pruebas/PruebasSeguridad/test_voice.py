"""
Pruebas de la lambda de envío de Voz (Api_V1_Voice_Send-batch).

El cliente de AWS End User Messaging Voice (pinpoint-sms-voice-v2) se mockea. Se verifica
la personalización del texto (TTS), los parámetros de la llamada y el registro de estados
en {customer}_sendStatus_{proceso}, en éxito y en fallo.
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
VOICE_PATH = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Voice_Send-batch' / 'lambda_function.py'


def _load():
    spec = importlib.util.spec_from_file_location('voice_mod', str(VOICE_PATH))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _event(customer, process_id, message, data):
    return {'Records': [{'body': json.dumps({
        'customerName': customer, 'processId': process_id,
        'headers': ['Identificacion', 'Celular', 'Nombre'],
        'voiceMessage': message, 'data': data,
    })}]}


@pytest.fixture
def voice():
    with mock_aws():
        boto3.client('dynamodb', region_name='us-east-1').create_table(
            TableName='empresa_sendStatus_P1',
            KeySchema=[{'AttributeName': 'sendStatusId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'sendStatusId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        yield _load()


def _status_items():
    return boto3.resource('dynamodb', region_name='us-east-1').Table('empresa_sendStatus_P1').scan()['Items']


def test_voz_llama_y_registra_estado(voice, monkeypatch):
    llamadas = []
    monkeypatch.setattr(voice, 'ORIGINATION_IDENTITY', 'phone-pool-demo')
    monkeypatch.setattr(voice.voice, 'send_voice_message',
                        lambda **kw: llamadas.append(kw) or {'MessageId': 'VID-1'})

    data = [['100', '+573001112233', 'Ana'], ['200', '+573004445566', 'Luis']]
    voice.lambda_handler(_event('empresa', 'P1', 'Hola {{Nombre}}, le llamamos de la empresa.', data), None)

    # Se personalizó el mensaje por destinatario
    cuerpos = [k['MessageBody'] for k in llamadas]
    assert 'Hola Ana, le llamamos de la empresa.' in cuerpos
    assert 'Hola Luis, le llamamos de la empresa.' in cuerpos
    # Lleva la voz de Polly y el número de destino E.164
    assert llamadas[0]['VoiceId'] == voice.VOICE_ID
    assert llamadas[0]['DestinationPhoneNumber'] == '+573001112233'
    # 2 estados en estado 1 (llamada iniciada)
    items = _status_items()
    assert len(items) == 2
    assert all(int(i['state']) == 1 for i in items)


def test_voz_sin_origen_marca_rechazado(voice, monkeypatch):
    monkeypatch.setattr(voice, 'ORIGINATION_IDENTITY', '')  # sin origen configurado
    voice.lambda_handler(_event('empresa', 'P1', 'x', [['1', '+573001112233', 'Ana']]), None)
    items = _status_items()
    assert len(items) == 1
    assert int(items[0]['state']) == 3  # rechazado


def test_voz_sin_mensaje_marca_rechazado(voice, monkeypatch):
    monkeypatch.setattr(voice, 'ORIGINATION_IDENTITY', 'phone-pool-demo')
    monkeypatch.setattr(voice.voice, 'send_voice_message', lambda **kw: {'MessageId': 'X'})
    voice.lambda_handler(_event('empresa', 'P1', '', [['1', '+573001112233', 'Ana']]), None)
    items = _status_items()
    assert len(items) == 1
    assert int(items[0]['state']) == 3  # rechazado: sin texto que leer
