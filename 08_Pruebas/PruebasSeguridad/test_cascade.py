"""
Pruebas de la CASCADA omnicanal (Opción A). Ver PLAN_CASCADA.md.

- Motor puro `decide_next` + `classify_outcome` (sin AWS): la lógica de escalamiento.
- Integración con moto: Dispatch (crea run+contactos, encola paso 0, debita) y Advance (tick:
  confirma / escala / frena por saldo según el estado leído de sendStatus).
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
TENANT = '900123'


def _load(folder, alias):
    p = DIR / folder / 'lambda_function.py'
    spec = importlib.util.spec_from_file_location(alias, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# ============================ Motor puro (sin AWS) ============================
@pytest.fixture(scope='module')
def eng():
    return _load('Api_V1_Cascade_Advance', 'cascade_adv_eng')


STEPS = [{'channel': 'WSP', 'content': 'hsm'}, {'channel': 'SMS', 'content': 'txt'}, {'channel': 'VOZ', 'content': 'voz'}]
CHEAP = lambda ch: 10  # noqa: E731
YES = lambda ch: True  # noqa: E731


def test_confirmado_done(eng):
    d = eng.decide_next(STEPS, 0, 'confirmed', 999, 60, 10**9, CHEAP, YES)
    assert d['action'] == 'done'


def test_pendiente_dentro_de_ventana_wait(eng):
    d = eng.decide_next(STEPS, 0, 'pending', 10, 60, 10**9, CHEAP, YES)
    assert d['action'] == 'wait'


def test_pendiente_vencido_escala(eng):
    d = eng.decide_next(STEPS, 0, 'pending', 61, 60, 10**9, CHEAP, YES)
    assert d['action'] == 'send' and d['stepIndex'] == 1 and d['channel'] == 'SMS'


def test_fallo_escala_de_inmediato(eng):
    # Un fallo duro no espera la ventana.
    d = eng.decide_next(STEPS, 0, 'failed', 0, 60, 10**9, CHEAP, YES)
    assert d['action'] == 'send' and d['channel'] == 'SMS'


def test_ultimo_paso_agota(eng):
    d = eng.decide_next(STEPS, 2, 'failed', 0, 60, 10**9, CHEAP, YES)
    assert d['action'] == 'exhausted'


def test_salta_canal_sin_consentimiento(eng):
    # Sin consentimiento en SMS (paso 1) → salta a VOZ (paso 2).
    consent = lambda ch: ch != 'SMS'  # noqa: E731
    d = eng.decide_next(STEPS, 0, 'failed', 0, 60, 10**9, CHEAP, consent)
    assert d['action'] == 'send' and d['channel'] == 'VOZ' and d['stepIndex'] == 2


def test_frena_por_saldo(eng):
    d = eng.decide_next(STEPS, 0, 'failed', 0, 60, 5, CHEAP, YES)  # saldo 5 < costo 10
    assert d['action'] == 'budget'


@pytest.mark.parametrize('state,criterion,expected', [
    (None, 'delivered', 'pending'),
    (3, 'delivered', 'failed'),
    (11, 'sent', 'failed'),
    (1, 'sent', 'confirmed'),
    (1, 'delivered', 'pending'),
    (2, 'delivered', 'confirmed'),
    (2, 'read', 'pending'),
    (4, 'read', 'confirmed'),
    (5, 'read', 'confirmed'),
])
def test_classify_outcome(eng, state, criterion, expected):
    assert eng.classify_outcome(state, criterion) == expected


# ============================ Integración (moto) ============================
def _mk(ddb, name, pk, gsi=None):
    attrs = [{'AttributeName': pk, 'AttributeType': 'S'}]
    kwargs = {'TableName': name, 'KeySchema': [{'AttributeName': pk, 'KeyType': 'HASH'}],
              'BillingMode': 'PAY_PER_REQUEST'}
    if gsi:
        attrs.append({'AttributeName': gsi, 'AttributeType': 'S'})
        kwargs['GlobalSecondaryIndexes'] = [{
            'IndexName': gsi + '-index',
            'KeySchema': [{'AttributeName': gsi, 'KeyType': 'HASH'}],
            'Projection': {'ProjectionType': 'ALL'}}]
    kwargs['AttributeDefinitions'] = attrs
    ddb.create_table(**kwargs)


def _mk_composite(ddb, name, pk, sk):
    ddb.create_table(
        TableName=name,
        KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}, {'AttributeName': sk, 'KeyType': 'RANGE'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}, {'AttributeName': sk, 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


def _base_tables(ddb):
    _mk(ddb, 'cascadeRun', 'cascadeRunId', gsi='customerId')
    _mk(ddb, 'cascadeContact', 'cascadeContactId', gsi='cascadeRunId')
    _mk(ddb, 'customerBalance', 'customerId')
    _mk(ddb, 'walletTransaction', 'txId')
    _mk(ddb, 'pricingRate', 'customerId')  # simplificado (dispatch lee con get_item)


def _queues(monkeypatch, mod):
    sqs = boto3.client('sqs', region_name='us-east-1')
    urls = {}
    for ch, q in (('EM', 'Email_Send-batch-template-EM'), ('SMS', 'Sms_Send-batch'),
                  ('WSP', 'Wsp_Send-batch'), ('VOZ', 'Voice_Send-batch')):
        urls[ch] = sqs.create_queue(QueueName=q)['QueueUrl']
    monkeypatch.setattr(mod, 'CHANNEL_QUEUE', urls)
    return urls


def _drain(url):
    sqs = boto3.client('sqs', region_name='us-east-1')
    out = []
    while True:
        msgs = sqs.receive_message(QueueUrl=url, MaxNumberOfMessages=10).get('Messages', [])
        if not msgs:
            break
        for m in msgs:
            out.append(json.loads(m['Body']))
            sqs.delete_message(QueueUrl=url, ReceiptHandle=m['ReceiptHandle'])
    return out


def _ctx(body):
    return {**body, 'requestContext': {'authorizer': {'customerId': 'CU1', 'customer': 'empresa', 'nit': '900123'}}}


CSV_WSP = "Id;Celular;Nombre\n1;3001234567;Ana\n2;3002345678;Luis\n3;3003456789;Eva\n"


def test_dispatch_crea_run_encola_paso0_y_debita(monkeypatch):
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        _base_tables(ddb)
        res.Table('customerBalance').put_item(Item={'customerId': 'CU1', 'balance': 100000})
        s3 = boto3.client('s3', region_name='us-east-1')
        s3.create_bucket(Bucket='mailconnect-900123')
        s3.put_object(Bucket='mailconnect-900123', Key='database/base.csv', Body=CSV_WSP.encode('utf-8'))

        disp = _load('Api_V1_Cascade_Dispatch', 'cascade_disp')
        urls = _queues(monkeypatch, disp)

        event = _ctx({'name': 'Cobranza', 'dataPath': 'database/base.csv', 'waitMinutes': 120,
                      'successCriterion': 'delivered',
                      'steps': [{'channel': 'WSP', 'content': 'plantilla_hsm'},
                                {'channel': 'SMS', 'content': 'Hola {{Nombre}}, ...'}]})
        resp = disp.lambda_handler(event, None)
        assert resp['statusCode'] == 201
        run_id = resp['data']['cascadeRunId']
        assert resp['data']['contacts'] == 3

        # Se encolaron 3 envíos por WhatsApp (paso 0), con correlación processId/uniqueId.
        msgs = _drain(urls['WSP'])
        assert len(msgs) == 3
        assert all(m['processId'] == run_id and m['channel'] == 'WSP' for m in msgs)
        assert all(m['uniqueId'] == m['cascadeContactId'] for m in msgs)

        # Débito del paso 0: WhatsApp, 3 destinatarios → mín. 5000 + IVA = 5950.
        bal = res.Table('customerBalance').get_item(Key={'customerId': 'CU1'})['Item']['balance']
        assert int(bal) == 100000 - 5950

        # Run + 3 contactos awaiting en el paso 0.
        run = res.Table('cascadeRun').get_item(Key={'cascadeRunId': run_id})['Item']
        assert run['status'] == 'running' and int(run['counts']['inFlight']) == 3
        contacts = res.Table('cascadeContact').query(
            IndexName='cascadeRunId-index', KeyConditionExpression=Key('cascadeRunId').eq(run_id))['Items']
        assert len(contacts) == 3 and all(c['status'] == 'awaiting' and int(c['stepIndex']) == 0 for c in contacts)


def _seed_run_and_contact(res, run_id, contact_id, balance=100000, wait=0):
    _base_state(res, balance)
    res.Table('cascadeRun').put_item(Item={
        'cascadeRunId': run_id, 'customerId': 'CU1', 'customer': 'empresa', 'nit': '900123',
        'name': 'Cobranza', 'successCriterion': 'delivered', 'waitMinutes': wait,
        'steps': [{'channel': 'WSP', 'content': 'hsm'}, {'channel': 'SMS', 'content': 'texto SMS'}],
        'status': 'running', 'counts': {'total': 1, 'confirmed': 0, 'exhausted': 0, 'inFlight': 1, 'budget': 0}})
    res.Table('cascadeContact').put_item(Item={
        'cascadeContactId': contact_id, 'cascadeRunId': run_id, 'customerId': 'CU1',
        'contactKey': '3001234567', 'row': ['1', '3001234567', 'Ana'], 'stepIndex': 0, 'status': 'awaiting',
        'lastChannel': 'WSP', 'lastSentAt': '2020-01-01 00:00:00', 'nextCheckAt': '2020-01-01 00:00:00',
        'history': [{'channel': 'WSP', 'sentAt': '2020-01-01 00:00:00', 'uniqueId': contact_id}]})


def _base_state(res, balance):
    res.Table('customerBalance').put_item(Item={'customerId': 'CU1', 'balance': balance})


def _seed_status(ddb, res, run_id, contact_id, state):
    _mk_composite(ddb, '{}_sendStatus'.format(TENANT), 'processId', 'sendStatusId')
    res.Table('{}_sendStatus'.format(TENANT)).put_item(Item={
        'processId': run_id, 'sendStatusId': 's1', 'uniqueId': contact_id, 'state': state})


def test_advance_escala_al_fallar(monkeypatch):
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        _base_tables(ddb)
        run_id, contact_id = 'R1', 'C1'
        _seed_run_and_contact(res, run_id, contact_id)
        _seed_status(ddb, res, run_id, contact_id, 3)  # 3 = rechazado/fallido

        adv = _load('Api_V1_Cascade_Advance', 'cascade_adv1')
        urls = _queues(monkeypatch, adv)
        adv.lambda_handler({}, None)

        # Escaló a SMS (paso 1) y encoló el envío por SMS.
        c = res.Table('cascadeContact').get_item(Key={'cascadeContactId': contact_id})['Item']
        assert int(c['stepIndex']) == 1 and c['lastChannel'] == 'SMS' and c['status'] == 'awaiting'
        sms = _drain(urls['SMS'])
        assert len(sms) == 1 and sms[0]['channel'] == 'SMS' and sms[0]['uniqueId'] == contact_id
        # Debitó el costo unitario de SMS (55 * 1.19 = 65).
        bal = int(res.Table('customerBalance').get_item(Key={'customerId': 'CU1'})['Item']['balance'])
        assert bal == 100000 - 65


def test_advance_confirma_si_entregado(monkeypatch):
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        _base_tables(ddb)
        run_id, contact_id = 'R2', 'C2'
        _seed_run_and_contact(res, run_id, contact_id)
        _seed_status(ddb, res, run_id, contact_id, 2)  # 2 = entregado → criterio 'delivered' cumplido

        adv = _load('Api_V1_Cascade_Advance', 'cascade_adv2')
        urls = _queues(monkeypatch, adv)
        adv.lambda_handler({}, None)

        c = res.Table('cascadeContact').get_item(Key={'cascadeContactId': contact_id})['Item']
        assert c['status'] == 'confirmed'
        assert _drain(urls['SMS']) == []  # no escaló
        # El run se cierra (ya no hay contactos en vuelo).
        run = res.Table('cascadeRun').get_item(Key={'cascadeRunId': run_id})['Item']
        assert run['status'] == 'done' and int(run['counts']['confirmed']) == 1


def test_advance_frena_sin_saldo(monkeypatch):
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        _base_tables(ddb)
        run_id, contact_id = 'R3', 'C3'
        _seed_run_and_contact(res, run_id, contact_id, balance=10)  # saldo insuficiente para SMS
        _seed_status(ddb, res, run_id, contact_id, 3)  # falla → intentaría escalar

        adv = _load('Api_V1_Cascade_Advance', 'cascade_adv3')
        urls = _queues(monkeypatch, adv)
        adv.lambda_handler({}, None)

        c = res.Table('cascadeContact').get_item(Key={'cascadeContactId': contact_id})['Item']
        assert c['status'] == 'budget'          # frenado por saldo
        assert _drain(urls['SMS']) == []         # no se encoló nada
        assert int(res.Table('customerBalance').get_item(Key={'customerId': 'CU1'})['Item']['balance']) == 10
