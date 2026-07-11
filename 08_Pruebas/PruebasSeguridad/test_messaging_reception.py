"""
Pruebas de Api_V1_Messaging_ReceptionStatus: procesa los eventos de entrega de End User
Messaging (SMS y Voz) y añade filas de estado a {customer}_sendStatus_{proceso}.
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
PATH = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Messaging_ReceptionStatus' / 'lambda_function.py'


def _load():
    spec = importlib.util.spec_from_file_location('recep_mod', str(PATH))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def recep():
    with mock_aws():
        boto3.client('dynamodb', region_name='us-east-1').create_table(
            TableName='empresa_sendStatus',
            KeySchema=[{'AttributeName': 'processId', 'KeyType': 'HASH'},
                       {'AttributeName': 'sendStatusId', 'KeyType': 'RANGE'}],
            AttributeDefinitions=[{'AttributeName': 'processId', 'AttributeType': 'S'},
                                  {'AttributeName': 'sendStatusId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        yield _load()


def _sns_event(eum_event):
    """Envuelve un evento EUM como llega por SNS→Lambda."""
    return {'Records': [{'Sns': {'Message': json.dumps(eum_event)}}]}


def _eum(event_type, message_id='MID-1'):
    return {
        'eventType': event_type,
        'messageId': message_id,
        'destinationPhoneNumber': '+573001112233',
        'eventTimestamp': 1720000000000,
        'context': {'customer': 'empresa', 'processId': 'P1', 'uniqueId': '100'},
    }


def _items():
    return boto3.resource('dynamodb', region_name='us-east-1').Table('empresa_sendStatus').scan()['Items']


def test_sms_entregado_registra_estado_2(recep):
    recep.lambda_handler(_sns_event(_eum('TEXT_DELIVERED')), None)
    items = _items()
    assert len(items) == 1
    assert int(items[0]['state']) == 2
    assert items[0]['type1'] == 'SMS'
    assert items[0]['type2'] == 'TEXT_DELIVERED'


def test_sms_bloqueado_registra_estado_3(recep):
    recep.lambda_handler(_sns_event(_eum('TEXT_BLOCKED')), None)
    assert int(_items()[0]['state']) == 3


def test_voz_contestada_registra_estado_2(recep):
    recep.lambda_handler(_sns_event(_eum('VOICE_ANSWERED')), None)
    it = _items()[0]
    assert int(it['state']) == 2
    assert it['type1'] == 'VOZ'


def test_voz_fallida_estado_3(recep):
    recep.lambda_handler(_sns_event(_eum('VOICE_FAILED')), None)
    assert int(_items()[0]['state']) == 3


def test_evento_no_mapeado_se_ignora(recep):
    recep.lambda_handler(_sns_event(_eum('TEXT_UNSUPPORTED_XYZ')), None)
    assert len(_items()) == 0


def test_sin_context_se_omite(recep):
    ev = _eum('TEXT_DELIVERED')
    ev.pop('context')
    recep.lambda_handler(_sns_event(ev), None)
    assert len(_items()) == 0


def test_sqs_envuelve_sns(recep):
    # Evento que llega por SQS envolviendo SNS.
    inner = {'Message': json.dumps(_eum('TEXT_DELIVERED'))}
    event = {'Records': [{'body': json.dumps(inner)}]}
    recep.lambda_handler(event, None)
    assert int(_items()[0]['state']) == 2
