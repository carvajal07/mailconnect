"""
Cascada omnicanal — motor (Tick) + Create.

Verifica la máquina de estados por contacto SIN enviar de verdad: los "envíos" se
encolan a colas SQS de moto (se asserta el mensaje) y la confirmación de entrega/lectura
se simula escribiendo filas en {tenant}_sendStatus / _sendDetail. Cubre: materialización
de contactos, envío + débito de saldo, confirmación (para), escalamiento por fallo y por
timeout, agotamiento, tope de presupuesto, salto por consentimiento y pausa por saldo.
"""
import importlib.util
import io
import json
import os
import time
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
LAMBDAS = REPO_ROOT / '04_Backend' / 'lambdas'

CID = 'CU1'
CUST = 'empresa'
NIT = '900123'
TENANT = '900123'
CTX = {'requestContext': {'authorizer': {'customerId': CID, 'customer': CUST, 'nit': NIT}}}

CSV = 'id,correo,celular,nombre\n1,ana@x.com,3001112233,Ana\n2,beto@x.com,3004445566,Beto\n'


def _load(name, folder):
    spec = importlib.util.spec_from_file_location(name, str(LAMBDAS / folder / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _mk_table(ddb, name, pk, sk=None, gsi=None):
    attrs = [{'AttributeName': pk, 'AttributeType': 'S'}]
    schema = [{'AttributeName': pk, 'KeyType': 'HASH'}]
    if sk:
        attrs.append({'AttributeName': sk, 'AttributeType': 'S'})
        schema.append({'AttributeName': sk, 'KeyType': 'RANGE'})
    kwargs = dict(TableName=name, KeySchema=schema, AttributeDefinitions=attrs, BillingMode='PAY_PER_REQUEST')
    if gsi:
        gk = gsi
        if not any(a['AttributeName'] == gk for a in attrs):
            attrs.append({'AttributeName': gk, 'AttributeType': 'S'})
        kwargs['AttributeDefinitions'] = attrs
        kwargs['GlobalSecondaryIndexes'] = [{
            'IndexName': gk + '-index',
            'KeySchema': [{'AttributeName': gk, 'KeyType': 'HASH'}],
            'Projection': {'ProjectionType': 'ALL'}}]
    ddb.create_table(**kwargs)


@pytest.fixture
def env():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        sqs = boto3.client('sqs', region_name='us-east-1')
        # Colas de los 4 canales.
        urls = {ch: sqs.create_queue(QueueName='q_' + ch)['QueueUrl'] for ch in ('EM', 'SMS', 'WSP', 'VOZ')}
        os.environ['URL_SQS_EM'] = urls['EM']
        os.environ['URL_SQS_SMS'] = urls['SMS']
        os.environ['URL_SQS_WSP'] = urls['WSP']
        os.environ['URL_SQS_VOICE'] = urls['VOZ']
        # Tablas.
        _mk_table(ddb, 'cascadeRun', 'cascadeRunId', gsi='customerId')
        _mk_table(ddb, 'cascadeContact', 'cascadeContactId', gsi='cascadeRunId')
        _mk_table(ddb, 'customerBalance', 'customerId')
        _mk_table(ddb, 'walletTransaction', 'txId')
        _mk_table(ddb, 'databaseFile', 'databaseFileId', gsi='customerId')
        _mk_table(ddb, f'{TENANT}_sendStatus', 'processId', 'sendStatusId')
        _mk_table(ddb, f'{TENANT}_sendDetail', 'processId', 'sendDetailId')
        _mk_table(ddb, f'{TENANT}_blackList', 'email')
        _mk_table(ddb, f'{TENANT}_unsubscribe', 'email')
        # Base CSV en S3 + registro databaseFile.
        s3 = boto3.client('s3', region_name='us-east-1')
        s3.create_bucket(Bucket=f'mailconnect-{TENANT}')
        s3.put_object(Bucket=f'mailconnect-{TENANT}', Key='database/2026/base.csv', Body=CSV.encode('utf-8'))
        res.Table('databaseFile').put_item(Item={
            'databaseFileId': 'db1', 'customerId': CID, 'customer': CUST,
            's3Path': 'database/2026/base.csv', 'delimiter': ',',
            'columns': ['id', 'correo', 'celular', 'nombre']})
        res.Table('customerBalance').put_item(Item={'customerId': CID, 'balance': 100000})

        create = _load('casc_create', 'Api_V1_Cascade_Create')
        tick = _load('casc_tick', 'Api_V1_Cascade_Tick')
        yield {'create': create, 'tick': tick, 'res': res, 'sqs': sqs, 'urls': urls}
        for k in ('URL_SQS_EM', 'URL_SQS_SMS', 'URL_SQS_WSP', 'URL_SQS_VOICE'):
            os.environ.pop(k, None)


# --- helpers ---------------------------------------------------------------
def _steps_em_sms():
    return [{'channel': 'EM', 'template': 't_em', 'from': 'no-reply@x.com'},
            {'channel': 'SMS', 'body': 'Hola {{nombre}}'}]


def _create_run(env, steps=None, confirm_on='delivered', budget=None, timeout=60):
    payload = {'name': 'Cobranza', 'databaseFileId': 'db1',
               'emailCol': 1, 'phoneCol': 2, 'nameCol': 3,
               'steps': steps or _steps_em_sms(), 'confirmOn': confirm_on, 'stepTimeoutMin': timeout}
    if budget is not None:
        payload['budgetCap'] = budget
    resp = env['create'].lambda_handler({**payload, **CTX}, None)
    assert resp['statusCode'] == 201, resp
    run_id = resp['data']['cascadeRunId']
    env['res'].Table('cascadeRun').update_item(
        Key={'cascadeRunId': run_id}, UpdateExpression='SET #s = :r',
        ExpressionAttributeNames={'#s': 'status'}, ExpressionAttributeValues={':r': 'running'})
    return run_id


def _contacts(env, run_id):
    from boto3.dynamodb.conditions import Key
    r = env['res'].Table('cascadeContact').query(
        IndexName='cascadeRunId-index', KeyConditionExpression=Key('cascadeRunId').eq(run_id))
    return {it['name']: it for it in r['Items']}


def _tick(env, run_id):
    return env['tick'].lambda_handler({'cascadeRunId': run_id}, None)


def _qcount(env, ch):
    a = env['sqs'].get_queue_attributes(QueueUrl=env['urls'][ch], AttributeNames=['ApproximateNumberOfMessages'])
    return int(a['Attributes']['ApproximateNumberOfMessages'])


def _sim_email(env, cid, step, state):
    pid = 'csc-{}-{}'.format(cid, step)
    mid = 'M-{}-{}'.format(cid, state)
    env['res'].Table(f'{TENANT}_sendDetail').put_item(Item={'processId': pid, 'sendDetailId': mid, 'uniqueId': cid})
    env['res'].Table(f'{TENANT}_sendStatus').put_item(Item={'processId': pid, 'sendStatusId': 's' + mid, 'messageId': mid, 'state': state})


def _sim_phone(env, cid, step, state):
    pid = 'csc-{}-{}'.format(cid, step)
    env['res'].Table(f'{TENANT}_sendStatus').put_item(Item={
        'processId': pid, 'sendStatusId': 's{}{}'.format(cid, state), 'messageId': 'm', 'uniqueId': cid, 'state': state})


def _bal(env):
    return int(env['res'].Table('customerBalance').get_item(Key={'customerId': CID})['Item']['balance'])


# --- tests -----------------------------------------------------------------
def test_create_materializes_contacts(env):
    run_id = _create_run(env)
    contacts = _contacts(env, run_id)
    assert set(contacts) == {'Ana', 'Beto'}
    assert contacts['Ana']['email'] == 'ana@x.com'
    assert contacts['Ana']['phone'] == '+573001112233'   # normalizado E.164
    assert contacts['Ana']['status'] == 'pending'


def test_tick_sends_first_channel_and_debits(env):
    run_id = _create_run(env)
    _tick(env, run_id)
    contacts = _contacts(env, run_id)
    assert contacts['Ana']['status'] == 'awaiting'
    assert contacts['Ana']['currentChannel'] == 'EM'
    assert _qcount(env, 'EM') == 2            # ambos por correo (paso 0)
    assert _bal(env) == 100000 - 2 * 10       # EM = round(8*1.19)=10 c/u


def test_delivered_confirms_and_stops(env):
    run_id = _create_run(env)
    _tick(env, run_id)                         # → awaiting (EM)
    ana = _contacts(env, run_id)['Ana']
    _sim_email(env, ana['cascadeContactId'], 0, 2)   # entregado
    _tick(env, run_id)
    ana2 = _contacts(env, run_id)['Ana']
    assert ana2['status'] == 'confirmed'
    # No re-envía: la cola EM sigue con los 2 del primer tick (Ana no generó uno nuevo).
    assert _qcount(env, 'EM') == 2


def test_escalates_to_next_channel_on_timeout(env):
    run_id = _create_run(env)
    _tick(env, run_id)                         # EM enviado, awaiting
    # Fuerza el vencimiento del timeout de Beto (sin confirmación).
    beto = _contacts(env, run_id)['Beto']
    env['res'].Table('cascadeContact').update_item(
        Key={'cascadeContactId': beto['cascadeContactId']},
        UpdateExpression='SET nextEscalationAt = :p', ExpressionAttributeValues={':p': int(time.time()) - 10})
    _tick(env, run_id)                         # timeout → escala a SMS (pending, step 1)
    beto2 = _contacts(env, run_id)['Beto']
    assert beto2['status'] == 'pending' and int(beto2['stepIndex']) == 1
    _tick(env, run_id)                         # envía SMS
    beto3 = _contacts(env, run_id)['Beto']
    assert beto3['status'] == 'awaiting' and beto3['currentChannel'] == 'SMS'
    assert _qcount(env, 'SMS') >= 1


def test_failed_channel_escalates(env):
    run_id = _create_run(env)
    _tick(env, run_id)
    ana = _contacts(env, run_id)['Ana']
    _sim_email(env, ana['cascadeContactId'], 0, 3)   # rechazado → escala
    _tick(env, run_id)
    ana2 = _contacts(env, run_id)['Ana']
    assert ana2['status'] == 'pending' and int(ana2['stepIndex']) == 1


def test_exhausted_when_no_more_channels(env):
    run_id = _create_run(env, steps=[{'channel': 'SMS', 'body': 'Hola'}])
    _tick(env, run_id)                         # envía SMS, awaiting
    c = _contacts(env, run_id)['Ana']
    env['res'].Table('cascadeContact').update_item(
        Key={'cascadeContactId': c['cascadeContactId']},
        UpdateExpression='SET nextEscalationAt = :p', ExpressionAttributeValues={':p': int(time.time()) - 10})
    _tick(env, run_id)                         # timeout, sin más canales → exhausted
    assert _contacts(env, run_id)['Ana']['status'] == 'exhausted'


def test_budget_cap_stops_sends(env):
    # budget 5 < costo EM (10) → no envía, agota por presupuesto.
    run_id = _create_run(env, budget=5)
    _tick(env, run_id)
    contacts = _contacts(env, run_id)
    assert all(c['status'] == 'exhausted' for c in contacts.values())
    assert _qcount(env, 'EM') == 0
    assert _bal(env) == 100000                 # no se debitó nada


def test_consent_skip_advances_channel(env):
    # Ana bloqueada por correo → salta al SMS en el mismo tick.
    env['res'].Table(f'{TENANT}_blackList').put_item(Item={'email': 'ana@x.com'})
    run_id = _create_run(env)
    _tick(env, run_id)
    ana = _contacts(env, run_id)['Ana']
    assert ana['currentChannel'] == 'SMS' and int(ana['stepIndex']) == 1
    assert ana['status'] == 'awaiting'


def test_insufficient_balance_pauses_run(env):
    env['res'].Table('customerBalance').put_item(Item={'customerId': CID, 'balance': 0})
    run_id = _create_run(env)
    _tick(env, run_id)
    run = env['res'].Table('cascadeRun').get_item(Key={'cascadeRunId': run_id})['Item']
    assert run['status'] == 'paused'
    # El contacto vuelve a pending (reintenta al recargar).
    assert any(c['status'] == 'pending' for c in _contacts(env, run_id).values())
