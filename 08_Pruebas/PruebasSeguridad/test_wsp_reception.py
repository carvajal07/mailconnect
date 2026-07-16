"""
Pruebas de Api_V1_Wsp_ReceptionStatus: mapea los recibos de Meta (SNS de End User
Messaging Social) a nuestro estado, ubicando el cliente/proceso por el índice messageIndex,
y escribe la fila en {customer}_sendStatus.
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
DIR = REPO_ROOT / '04_Backend' / 'lambdas'


def _load(folder):
    p = DIR / folder / 'lambda_function.py'
    spec = importlib.util.spec_from_file_location('wr_' + folder, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _sns(entry_obj):
    """Evento SNS como lo publica EUM Social: el entry de Meta va como STRING."""
    inner = {'whatsAppWebhookEntry': json.dumps(entry_obj)}
    return {'Records': [{'Sns': {'Message': json.dumps(inner)}}]}


def _entry(statuses):
    return {'changes': [{'field': 'messages', 'value': {'statuses': statuses}}]}


@pytest.fixture
def wr():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        ddb.create_table(
            TableName='messageIndex',
            KeySchema=[{'AttributeName': 'messageId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'messageId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        ddb.create_table(
            TableName='empresa_sendStatus',
            KeySchema=[{'AttributeName': 'processId', 'KeyType': 'HASH'},
                       {'AttributeName': 'sendStatusId', 'KeyType': 'RANGE'}],
            AttributeDefinitions=[{'AttributeName': 'processId', 'AttributeType': 'S'},
                                  {'AttributeName': 'sendStatusId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('messageIndex').put_item(Item={
            'messageId': 'wamid1', 'customer': 'empresa', 'processId': 'P1', 'uniqueId': 'u1', 'channel': 'WSP'})
        yield _load('Api_V1_Wsp_ReceptionStatus'), res


def _statuses_of(res, process_id='P1'):
    from boto3.dynamodb.conditions import Key
    return res.Table('empresa_sendStatus').query(
        KeyConditionExpression=Key('processId').eq(process_id))['Items']


def test_delivered_escribe_estado_2(wr):
    mod, res = wr
    out = mod.lambda_handler(_sns(_entry([
        {'id': 'wamid1', 'status': 'delivered', 'timestamp': '1700000000', 'recipient_id': '57300'}])), None)
    assert json.loads(out['body'])['procesados'] == 1
    items = _statuses_of(res)
    assert len(items) == 1
    assert int(items[0]['state']) == 2 and items[0]['type1'] == 'WSP' and items[0]['messageId'] == 'wamid1'


def test_read_es_abierto_estado_4(wr):
    mod, res = wr
    mod.lambda_handler(_sns(_entry([{'id': 'wamid1', 'status': 'read', 'timestamp': '1'}])), None)
    assert int(_statuses_of(res)[0]['state']) == 4


def test_failed_es_rechazado_estado_3(wr):
    mod, res = wr
    mod.lambda_handler(_sns(_entry([{'id': 'wamid1', 'status': 'failed', 'timestamp': '1'}])), None)
    assert int(_statuses_of(res)[0]['state']) == 3


def test_message_id_sin_indice_no_escribe(wr):
    mod, res = wr
    out = mod.lambda_handler(_sns(_entry([{'id': 'DESCONOCIDO', 'status': 'delivered', 'timestamp': '1'}])), None)
    body = json.loads(out['body'])
    assert body['procesados'] == 0 and body['sinIndice'] == 1
    assert _statuses_of(res) == []


def test_estado_no_mapeado_se_ignora(wr):
    mod, res = wr
    out = mod.lambda_handler(_sns(_entry([{'id': 'wamid1', 'status': 'accepted', 'timestamp': '1'}])), None)
    assert json.loads(out['body'])['procesados'] == 0
    assert _statuses_of(res) == []
