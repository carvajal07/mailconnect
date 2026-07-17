"""
Programar envíos (tabla scheduledSend):
  - Api_V1_Schedule_Create / _List / _Cancel / _Dispatch

El dispatcher (cron) refire el envío real invocando Prepare-batch; en las pruebas se MOCKEA
esa invocación (`_invoke_prepare_batch`) para verificar las transiciones de estado sin correr
la lambda real.
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
LAMBDAS = REPO_ROOT / '04_Backend' / 'lambdas'

PAST = '2000-01-01T00:00:00.000Z'      # ya venció → dispatcher lo dispara
FUTURE = '2999-01-01T00:00:00.000Z'    # aún no


def _load(name, folder):
    spec = importlib.util.spec_from_file_location(name, str(LAMBDAS / folder / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _mk_schedule_table():
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName='scheduledSend',
        KeySchema=[{'AttributeName': 'scheduleId', 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': 'scheduleId', 'AttributeType': 'S'},
                              {'AttributeName': 'customerId', 'AttributeType': 'S'}],
        GlobalSecondaryIndexes=[{
            'IndexName': 'customerId-index',
            'KeySchema': [{'AttributeName': 'customerId', 'KeyType': 'HASH'}],
            'Projection': {'ProjectionType': 'ALL'}}],
        BillingMode='PAY_PER_REQUEST')


def _mk_pk(name, pk):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


@pytest.fixture
def mods():
    with mock_aws():
        _mk_schedule_table()
        _mk_pk('campaign', 'campaignId')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        # Campaña aprobada y lista de CU1.
        res.Table('campaign').put_item(Item={
            'campaignId': 'C1', 'customerId': 'CU1', 'campaignName': 'Promo',
            'campaignState': 'Pendiente', 'approvalStatus': 'approved', 'template': 'T'})
        yield {
            'create': _load('sch_create', 'Api_V1_Schedule_Create'),
            'list': _load('sch_list', 'Api_V1_Schedule_List'),
            'cancel': _load('sch_cancel', 'Api_V1_Schedule_Cancel'),
            'dispatch': _load('sch_dispatch', 'Api_V1_Schedule_Dispatch'),
        }


def _ev(body=None, cid='CU1', role='owner', customer='empresa', nit='900', uid='U1'):
    return {**(body or {}), 'requestContext': {'authorizer': {
        'customerId': cid, 'customer': customer, 'nit': nit, 'tenantRole': role, 'userId': uid}}}


def _sched_table():
    return boto3.resource('dynamodb', region_name='us-east-1').Table('scheduledSend')


# ── Create ──────────────────────────────────────────────────────────────────
def test_create_ok(mods):
    resp = mods['create'].lambda_handler(_ev({'campaignId': 'C1', 'scheduledAt': FUTURE}), None)
    assert resp['statusCode'] == 201
    assert resp['data']['status'] == 'pending' and resp['data']['scheduleId']


def test_create_fecha_pasada_400(mods):
    resp = mods['create'].lambda_handler(_ev({'campaignId': 'C1', 'scheduledAt': PAST}), None)
    assert resp['statusCode'] == 400


def test_create_campana_inexistente_404(mods):
    assert mods['create'].lambda_handler(_ev({'campaignId': 'NOPE', 'scheduledAt': FUTURE}), None)['statusCode'] == 404


def test_create_otro_cliente_403(mods):
    # C1 es de CU1; un cliente CU2 no la puede programar.
    resp = mods['create'].lambda_handler(_ev({'campaignId': 'C1', 'scheduledAt': FUTURE}, cid='CU2'), None)
    assert resp['statusCode'] == 403


def test_create_rbac_operator_403(mods):
    resp = mods['create'].lambda_handler(_ev({'campaignId': 'C1', 'scheduledAt': FUTURE}, role='operator'), None)
    assert resp['statusCode'] == 403


def test_create_campana_enviando_409(mods):
    boto3.resource('dynamodb', region_name='us-east-1').Table('campaign').update_item(
        Key={'campaignId': 'C1'}, UpdateExpression='SET campaignState = :s',
        ExpressionAttributeValues={':s': 'Enviando'})
    assert mods['create'].lambda_handler(_ev({'campaignId': 'C1', 'scheduledAt': FUTURE}), None)['statusCode'] == 409


def test_create_aprobacion_pendiente_409(mods):
    boto3.resource('dynamodb', region_name='us-east-1').Table('campaign').update_item(
        Key={'campaignId': 'C1'}, UpdateExpression='SET approvalStatus = :a',
        ExpressionAttributeValues={':a': 'pending'})
    assert mods['create'].lambda_handler(_ev({'campaignId': 'C1', 'scheduledAt': FUTURE}), None)['statusCode'] == 409


# ── List ────────────────────────────────────────────────────────────────────
def test_list_muestra_y_aisla(mods):
    mods['create'].lambda_handler(_ev({'campaignId': 'C1', 'scheduledAt': FUTURE}), None)
    resp = mods['list'].lambda_handler(_ev(), None)
    assert resp['statusCode'] == 200 and resp['data']['count'] == 1
    # Otro cliente no ve nada.
    assert mods['list'].lambda_handler(_ev(cid='CU2'), None)['data']['count'] == 0


# ── Cancel ──────────────────────────────────────────────────────────────────
def test_cancel_ok_y_tenant(mods):
    sid = mods['create'].lambda_handler(_ev({'campaignId': 'C1', 'scheduledAt': FUTURE}), None)['data']['scheduleId']
    # Otro cliente no puede cancelarlo.
    assert mods['cancel'].lambda_handler(_ev({'scheduleId': sid}, cid='CU2'), None)['statusCode'] == 403
    # El dueño sí.
    assert mods['cancel'].lambda_handler(_ev({'scheduleId': sid}), None)['statusCode'] == 200
    item = _sched_table().get_item(Key={'scheduleId': sid})['Item']
    assert item['status'] == 'canceled'
    # Cancelar de nuevo → 409 (ya no está pending).
    assert mods['cancel'].lambda_handler(_ev({'scheduleId': sid}), None)['statusCode'] == 409


def test_cancel_no_existe_404(mods):
    assert mods['cancel'].lambda_handler(_ev({'scheduleId': 'ZZZ'}), None)['statusCode'] == 404


# ── Dispatch ────────────────────────────────────────────────────────────────
def _put_schedule(sid, scheduled_at, status='pending', cid='CU1'):
    _sched_table().put_item(Item={
        'scheduleId': sid, 'customerId': cid, 'customer': 'empresa', 'nit': '900',
        'userId': 'U1', 'tenantRole': 'owner', 'campaignId': 'C1', 'campaignName': 'Promo',
        'template': 'T', 'templateVersion': 1, 'scheduledAt': scheduled_at, 'status': status,
        'createdAt': PAST, 'firedAt': '', 'processId': '', 'error': ''})


def test_dispatch_dispara_los_vencidos_no_los_futuros(mods, monkeypatch):
    disp = mods['dispatch']
    calls = []
    monkeypatch.setattr(disp, '_invoke_prepare_batch', lambda item: calls.append(item['scheduleId']) or (True, 'OK'))
    _put_schedule('S_due', PAST)       # vencido → se dispara
    _put_schedule('S_future', FUTURE)  # aún no

    resp = disp.lambda_handler({}, None)
    import json
    body = json.loads(resp['body'])
    assert body['sent'] == 1 and body['fired'] == 1
    assert calls == ['S_due']
    assert _sched_table().get_item(Key={'scheduleId': 'S_due'})['Item']['status'] == 'sent'
    assert _sched_table().get_item(Key={'scheduleId': 'S_future'})['Item']['status'] == 'pending'


def test_dispatch_marca_failed_si_el_envio_falla(mods, monkeypatch):
    disp = mods['dispatch']
    monkeypatch.setattr(disp, '_invoke_prepare_batch', lambda item: (False, 'Saldo insuficiente'))
    _put_schedule('S_fail', PAST)

    disp.lambda_handler({}, None)
    item = _sched_table().get_item(Key={'scheduleId': 'S_fail'})['Item']
    assert item['status'] == 'failed' and 'Saldo' in item['error']


def test_dispatch_idempotente_no_redispara(mods, monkeypatch):
    disp = mods['dispatch']
    calls = []
    monkeypatch.setattr(disp, '_invoke_prepare_batch', lambda item: calls.append(item['scheduleId']) or (True, 'OK'))
    _put_schedule('S_due', PAST)
    disp.lambda_handler({}, None)   # dispara y marca 'sent'
    disp.lambda_handler({}, None)   # segunda corrida: ya no está pending
    assert calls == ['S_due']       # solo una vez


def test_dispatch_ignora_cancelados(mods, monkeypatch):
    disp = mods['dispatch']
    calls = []
    monkeypatch.setattr(disp, '_invoke_prepare_batch', lambda item: calls.append(item['scheduleId']) or (True, 'OK'))
    _put_schedule('S_cancel', PAST, status='canceled')
    disp.lambda_handler({}, None)
    assert calls == []
