"""
Pruebas del monitor de trabajos admin (Admin/Jobs): gating, enriquecido con estado
de campaña + conteo de envíos, progreso, bloqueos y filtros por estado/mes.
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
    spec = importlib.util.spec_from_file_location('jobs_' + folder, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _admin(payload=None):
    return {'body': None, 'requestContext': {'authorizer': {'role': 'admin'}}, **(payload or {})}


def _pk(name, pk):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}], BillingMode='PAY_PER_REQUEST')


def _pk_sk(name, pk, sk):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name,
        KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}, {'AttributeName': sk, 'KeyType': 'RANGE'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}, {'AttributeName': sk, 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


@pytest.fixture
def jobs():
    with mock_aws():
        _pk('campaign', 'campaignId')
        _pk('process', 'processId')
        _pk_sk('Acme_sendStatus', 'processId', 'sendStatusId')
        ddb = boto3.resource('dynamodb', region_name='us-east-1')
        ddb.Table('campaign').put_item(Item={'campaignId': 'CA1', 'campaignState': 'Enviando', 'channel': 'EM'})
        ddb.Table('campaign').put_item(Item={'campaignId': 'CA2', 'campaignState': 'Muestras', 'channel': 'SMS'})
        # Proceso real en curso (5 enviados de 10) con bloqueos.
        ddb.Table('process').put_item(Item={
            'processId': 'P1', 'customerName': 'Acme', 'campaignId': 'CA1', 'campaignName': 'Julio',
            'processState': 'Procesando', 'registersToSend': 10, 'parts': 1,
            'quantityBlacklist': 2, 'quantityUnsubscribe': 1, 'quantityDeletions': 3, 'date': '2026-07-05'})
        # Proceso de muestras (mes distinto).
        ddb.Table('process').put_item(Item={
            'processId': 'P2', 'customerName': 'Acme', 'campaignId': 'CA2', 'campaignName': 'Muestra',
            'processState': 'Muestras', 'registersToSend': 3, 'date': '2026-06-01'})
        st = ddb.Table('Acme_sendStatus')
        for i, m in enumerate(['m1', 'm2', 'm3', 'm4', 'm5']):
            st.put_item(Item={'processId': 'P1', 'sendStatusId': f's{i}', 'messageId': m, 'state': 1})
        yield _load('Api_V1_Admin_Jobs')


def test_requiere_admin(jobs):
    assert jobs.lambda_handler({'requestContext': {'authorizer': {'role': 'client'}}}, None)['statusCode'] == 403


def test_lista_con_progreso_y_bloqueos(jobs):
    resp = jobs.lambda_handler(_admin(), None)
    assert resp['statusCode'] == 200
    js = {j['processId']: j for j in resp['data']['jobs']}
    assert len(js) == 2
    p1 = js['P1']
    assert p1['sent'] == 5 and p1['registersToSend'] == 10
    assert p1['progress'] == 0.5
    assert p1['channelLabel'] == 'Correo'
    assert p1['campaignState'] == 'Enviando'
    assert p1['blocked'] == {'blacklist': 2, 'unsubscribe': 1, 'invalid': 3}
    # counts por estado.
    assert resp['data']['counts'].get('Procesando') == 1
    assert resp['data']['counts'].get('Muestras') == 1


def test_orden_reciente_primero(jobs):
    resp = jobs.lambda_handler(_admin(), None)
    fechas = [j['date'] for j in resp['data']['jobs']]
    assert fechas == sorted(fechas, reverse=True)  # 2026-07-05 antes que 2026-06-01


def test_filtro_por_estado(jobs):
    resp = jobs.lambda_handler(_admin({'state': 'Procesando'}), None)
    assert [j['processId'] for j in resp['data']['jobs']] == ['P1']


def test_filtro_por_mes(jobs):
    resp = jobs.lambda_handler(_admin({'month': '2026-06'}), None)
    assert [j['processId'] for j in resp['data']['jobs']] == ['P2']
