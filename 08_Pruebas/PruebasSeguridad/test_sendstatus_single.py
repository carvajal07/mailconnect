"""
Fase 1 — Tabla ÚNICA {customer}_sendStatus (PK processId + SK sendStatusId).

Prueba que varios procesos conviven en UNA sola tabla (antes había una tabla por
proceso) y que el query por processId aísla los estados de cada proceso. Usa la lambda
de envío SMS como escritor real y el helper de Statistics como lector.
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
from boto3.dynamodb.conditions import Key  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DIR = REPO_ROOT / '04_Backend' / 'lambdas'


def _load(folder, alias):
    p = DIR / folder / 'lambda_function.py'
    spec = importlib.util.spec_from_file_location(alias, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def env():
    with mock_aws():
        boto3.client('dynamodb', region_name='us-east-1').create_table(
            TableName='empresa_sendStatus',
            KeySchema=[{'AttributeName': 'processId', 'KeyType': 'HASH'},
                       {'AttributeName': 'sendStatusId', 'KeyType': 'RANGE'}],
            AttributeDefinitions=[{'AttributeName': 'processId', 'AttributeType': 'S'},
                                  {'AttributeName': 'sendStatusId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        yield _load('Api_V1_Sms_Send-batch', 'sms_single')


def _sms_event(process_id, data):
    return {'Records': [{'body': json.dumps({
        'customerName': 'empresa', 'processId': process_id,
        'headers': ['Id', 'Celular', 'Nombre'], 'smsBody': 'Hola {{Nombre}}', 'data': data,
    })}]}


def _query(process_id):
    table = boto3.resource('dynamodb', region_name='us-east-1').Table('empresa_sendStatus')
    return table.query(KeyConditionExpression=Key('processId').eq(process_id))['Items']


def test_dos_procesos_conviven_y_el_query_los_aisla(env, monkeypatch):
    monkeypatch.setattr(env, 'ORIGINATION_IDENTITY', 'sender-demo')
    monkeypatch.setattr(env.sms, 'send_text_message', lambda **kw: {'MessageId': 'X'})

    # Proceso P1: 2 destinatarios. Proceso P2: 1 destinatario. MISMA tabla.
    env.lambda_handler(_sms_event('P1', [['1', '+573001112233', 'Ana'], ['2', '+573004445566', 'Luis']]), None)
    env.lambda_handler(_sms_event('P2', [['3', '+573007778899', 'Eva']]), None)

    # La tabla tiene 3 filas en total, pero el query por proceso las separa.
    p1 = _query('P1')
    p2 = _query('P2')
    assert len(p1) == 2
    assert len(p2) == 1
    assert all(i['processId'] == 'P1' for i in p1)
    assert all(i['processId'] == 'P2' for i in p2)
    # Cada fila trae su PK+SK.
    assert all('sendStatusId' in i for i in p1 + p2)
