"""
Pruebas de Api_V1_Admin_Requeue: reencola SOLO las partes pendientes (las que no están
en processedParts) de un envío troceado atascado, reconstruyendo el trabajo desde resumeCtx.
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
    spec = importlib.util.spec_from_file_location('rq_' + folder, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _admin(payload=None):
    return {'body': None,
            'requestContext': {'authorizer': {'role': 'admin', 'user': 'ana@acme.co'}},
            **(payload or {})}


def _pk(name, pk):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}], BillingMode='PAY_PER_REQUEST')


RESUME = {
    'ctx': {'customerId': 'CU1', 'customerName': 'empresa', 'processId': 'P1',
            'campaignId': 'C1', 'attachment': False, 'fromEmail': 'a@b.co',
            'headers': ['Identificacion', 'Correo', 'Nombre'], 'templateName': 'T',
            'smsBody': '', 'wspTemplate': '', 'voiceMessage': '', 'nit': '900'},
    'bucket': 'mailconnect-900-database',
    'channelQueue': 'https://sqs.us-east-1.amazonaws.com/1/EM',
    'registersForMessage': 250,
    'unsubscribeExisted': True,
    'blacklistExisted': False,
}


@pytest.fixture
def rq():
    with mock_aws():
        _pk('process', 'processId')
        _pk('adminAudit', 'auditId')
        q = boto3.client('sqs', region_name='us-east-1').create_queue(QueueName='parts')['QueueUrl']
        mod = _load('Api_V1_Admin_Requeue')
        mod.URL_SQS_PREPARE_PART = q       # apuntar la cola de partes a la de prueba
        yield mod, q


def _drain(q):
    sqs = boto3.client('sqs', region_name='us-east-1')
    msgs = []
    while True:
        resp = sqs.receive_message(QueueUrl=q, MaxNumberOfMessages=10)
        got = resp.get('Messages', [])
        if not got:
            break
        msgs.extend(json.loads(m['Body']) for m in got)
        for m in got:
            sqs.delete_message(QueueUrl=q, ReceiptHandle=m['ReceiptHandle'])
    return msgs


def test_requiere_admin(rq):
    mod, _ = rq
    assert mod.lambda_handler({'requestContext': {'authorizer': {'role': 'client'}}}, None)['statusCode'] == 403


def test_reencola_solo_las_pendientes(rq):
    mod, q = rq
    res = boto3.resource('dynamodb', region_name='us-east-1')
    # 3 partes; la parte 1 ya está procesada → deben reencolarse SOLO la 2 y la 3.
    res.Table('process').put_item(Item={
        'processId': 'P1', 'campaignName': 'Promo', 'customerName': 'empresa',
        'parts': 3, 'processedParts': {'1'}, 'resumeCtx': RESUME})
    out = mod.lambda_handler(_admin({'processId': 'P1'}), None)
    assert out['statusCode'] == 200
    assert out['data']['requeued'] == 2
    assert out['data']['pendingParts'] == [2, 3]
    msgs = _drain(q)
    partes = sorted(m['part'] for m in msgs)
    assert partes == [2, 3]
    # El trabajo reconstruido trae los campos que espera el worker.
    m2 = next(m for m in msgs if m['part'] == 2)
    assert m2['prepareJob'] is True
    assert m2['partKey'] == '_parts/P1/2.json'
    assert m2['channelQueue'] == RESUME['channelQueue']
    assert m2['registersForMessage'] == 250
    assert m2['customerName'] == 'empresa'


def test_sin_pendientes_no_reencola(rq):
    mod, q = rq
    res = boto3.resource('dynamodb', region_name='us-east-1')
    res.Table('process').put_item(Item={
        'processId': 'P2', 'campaignName': 'X', 'parts': 2,
        'processedParts': {'1', '2'}, 'resumeCtx': RESUME})
    out = mod.lambda_handler(_admin({'processId': 'P2'}), None)
    assert out['statusCode'] == 200 and out['data']['requeued'] == 0
    assert _drain(q) == []


def test_sin_resume_ctx_409(rq):
    mod, _ = rq
    res = boto3.resource('dynamodb', region_name='us-east-1')
    res.Table('process').put_item(Item={'processId': 'P3', 'parts': 2})  # sin resumeCtx
    out = mod.lambda_handler(_admin({'processId': 'P3'}), None)
    assert out['statusCode'] == 409


def test_proceso_inexistente_404(rq):
    mod, _ = rq
    assert mod.lambda_handler(_admin({'processId': 'NOPE'}), None)['statusCode'] == 404


def test_falta_process_id_400(rq):
    mod, _ = rq
    assert mod.lambda_handler(_admin({}), None)['statusCode'] == 400
