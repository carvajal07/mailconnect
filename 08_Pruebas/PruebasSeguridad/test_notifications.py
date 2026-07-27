"""
Pruebas de las NOTIFICACIONES al owner (Bloque H): preferencias
(Api_V1_Notifications_Prefs, owner-gate), el barrido programado de reputación/resumen
(Api_V1_Notifications_Scan con dedup) y el aviso de saldo bajo de Prepare-batch.
DynamoDB y SES con moto.
"""
import os
import sys
import types
import importlib.util
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DIR = REPO_ROOT / '04_Backend' / 'lambdas'


def _load(folder, name):
    if 'pandas' not in sys.modules:
        sys.modules['pandas'] = types.ModuleType('pandas')
    p = DIR / folder / 'lambda_function.py'
    spec = importlib.util.spec_from_file_location(name, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _pk(name, pk):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


def _verify_sender():
    boto3.client('ses', region_name='us-east-1').verify_email_identity(
        EmailAddress='comunicaciones@mailconnect.com.co')


def _today(hour='10'):
    return datetime.now(timezone.utc).strftime('%Y-%m-%d') + 'T{}:00:00.000Z'.format(hour)


# ───────────────────────── Preferencias (owner-gate) ─────────────────────────

def _event(payload=None, customer_id='CU1', tenant_role='owner'):
    return {'requestContext': {'authorizer': {'customerId': customer_id, 'tenantRole': tenant_role}},
            **(payload or {})}


@pytest.fixture
def prefs():
    with mock_aws():
        _pk('customer', 'customerId')
        boto3.resource('dynamodb', region_name='us-east-1').Table('customer').put_item(
            Item={'customerId': 'CU1', 'company': 'Acme'})
        yield _load('Api_V1_Notifications_Prefs', 'notif_prefs')


def test_prefs_get_defaults(prefs):
    resp = prefs.lambda_handler(_event({'action': 'get'}), None)
    assert resp['statusCode'] == 200
    n = resp['data']['notify']
    assert n['reputation'] is True and n['digest'] is False and n['lowBalance'] is True
    assert n['lowBalanceThreshold'] == 20000


def test_prefs_set_owner(prefs):
    resp = prefs.lambda_handler(
        _event({'action': 'set', 'prefs': {'digest': True, 'lowBalanceThreshold': 50000}}), None)
    assert resp['statusCode'] == 200
    assert resp['data']['notify']['digest'] is True
    assert resp['data']['notify']['lowBalanceThreshold'] == 50000
    # Persistió.
    got = prefs.lambda_handler(_event({'action': 'get'}), None)['data']['notify']
    assert got['digest'] is True and got['lowBalanceThreshold'] == 50000


def test_prefs_set_no_owner_403(prefs):
    resp = prefs.lambda_handler(
        _event({'action': 'set', 'prefs': {'digest': True}}, tenant_role='operator'), None)
    assert resp['statusCode'] == 403


def test_prefs_sin_tenant_403(prefs):
    assert prefs.lambda_handler({'action': 'get', 'requestContext': {'authorizer': {}}}, None)['statusCode'] == 403


# ───────────────────────── Barrido programado (scan) ─────────────────────────

@pytest.fixture
def scan_env():
    with mock_aws():
        _verify_sender()
        _pk('customer', 'customerId')
        _pk('process', 'processId')
        _pk('user', 'userId')
        _pk('900_sendSummary', 'processId')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('customer').put_item(Item={
            'customerId': 'CU1', 'company': 'Acme', 'companyTin': '900',
            'notify': {'reputation': True, 'digest': True}})
        res.Table('user').put_item(Item={
            'userId': 'U1', 'customerId': 'CU1', 'email': 'owner@acme.co',
            'tenantRole': 'owner', 'active': True})
        # Proceso de HOY con reputación mala (rebote alto).
        res.Table('process').put_item(Item={
            'processId': 'P1', 'customerName': 'Acme', 'campaignId': 'CA1', 'date': _today()})
        res.Table('900_sendSummary').put_item(Item={
            'processId': 'P1', 'enviados': 100, 'entregados': 70, 'abiertos': 10,
            'rebotes': 20, 'quejas': 2})
        yield _load('Api_V1_Notifications_Scan', 'notif_scan')


def test_scan_reputacion_y_resumen(scan_env):
    resp = scan_env.lambda_handler({}, None)
    assert resp['statusCode'] == 200
    # Reputación crítica (20% rebote) + resumen del día → ambos se envían.
    assert resp['data']['reputationSent'] == 1
    assert resp['data']['digestSent'] == 1


def test_scan_dedup_mismo_dia(scan_env):
    scan_env.lambda_handler({}, None)
    # Segundo barrido el mismo día: ya se notificó → nada nuevo.
    resp = scan_env.lambda_handler({}, None)
    assert resp['data']['reputationSent'] == 0 and resp['data']['digestSent'] == 0
    assert resp['data']['skipped'] >= 2


def test_scan_respeta_preferencia_apagada(scan_env):
    boto3.resource('dynamodb', region_name='us-east-1').Table('customer').update_item(
        Key={'customerId': 'CU1'},
        UpdateExpression='SET notify = :n',
        ExpressionAttributeValues={':n': {'reputation': False, 'digest': False}})
    resp = scan_env.lambda_handler({}, None)
    assert resp['data']['reputationSent'] == 0 and resp['data']['digestSent'] == 0


# ───────────────────────── Saldo bajo (Prepare-batch) ─────────────────────────

@pytest.fixture
def pb():
    with mock_aws():
        _verify_sender()
        _pk('customer', 'customerId')
        _pk('user', 'userId')
        _pk('notificationLog', 'notifyKey')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('customer').put_item(Item={
            'customerId': 'CU1', 'company': 'Acme',
            'notify': {'lowBalance': True, 'lowBalanceThreshold': 20000}})
        res.Table('user').put_item(Item={
            'userId': 'U1', 'customerId': 'CU1', 'email': 'owner@acme.co',
            'tenantRole': 'owner', 'active': True})
        yield _load('Api_V1_Email_Prepare-batch-template', 'pb_lowbal')


def _st(pb, cid='CU1', name='Acme'):
    st = pb.ProcessState()
    st.customer_id = cid
    st.customer_name = name
    return st


def test_saldo_bajo_notifica_una_vez(pb):
    # Saldo por debajo del umbral → dedup por día: solo una notificación.
    pb.notify_low_balance_if_needed(_st(pb), 5000)
    pb.notify_low_balance_if_needed(_st(pb), 4000)
    logs = boto3.resource('dynamodb', region_name='us-east-1').Table('notificationLog').scan()['Items']
    low = [x for x in logs if x['kind'] == 'lowBalance']
    assert len(low) == 1


def test_saldo_suficiente_no_notifica(pb):
    pb.notify_low_balance_if_needed(_st(pb), 50000)
    logs = boto3.resource('dynamodb', region_name='us-east-1').Table('notificationLog').scan()['Items']
    assert not any(x['kind'] == 'lowBalance' for x in logs)


def test_saldo_bajo_desactivado_no_notifica(pb):
    boto3.resource('dynamodb', region_name='us-east-1').Table('customer').update_item(
        Key={'customerId': 'CU1'}, UpdateExpression='SET notify = :n',
        ExpressionAttributeValues={':n': {'lowBalance': False}})
    pb.notify_low_balance_if_needed(_st(pb), 1000)
    logs = boto3.resource('dynamodb', region_name='us-east-1').Table('notificationLog').scan()['Items']
    assert not any(x['kind'] == 'lowBalance' for x in logs)
