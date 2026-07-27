"""
Pruebas del CENTRO DE MANDO admin (Api_V1_Admin_Control-center): semáforo del pipeline
(procesos atascados, schedules fallidos, colas/DLQs), dinero del día, reputación con
tendencia (rollup sendSummary), salud de servicios y cola de auditoría. moto para
DynamoDB/SQS/SES; gate admin con 2ª barrera (helpers_auth).
"""
import importlib.util
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers_auth import make_token  # noqa: E402

LAMBDAS = Path(__file__).resolve().parents[2] / '04_Backend' / 'lambdas'

CORE_TABLES = ['user', 'customer', 'campaign', 'process', 'walletTransaction',
               'customerBalance', 'scheduledSend', 'messageTemplate', 'adminAudit']
PK = {'user': 'userId', 'customer': 'customerId', 'campaign': 'campaignId',
      'process': 'processId', 'walletTransaction': 'txId', 'customerBalance': 'customerId',
      'scheduledSend': 'scheduleId', 'messageTemplate': 'messageTemplateId',
      'adminAudit': 'auditId'}


def _load():
    spec = importlib.util.spec_from_file_location(
        'cc_mod', str(LAMBDAS / 'Api_V1_Admin_Control-center' / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _admin(body=None):
    return {**(body or {}), 'authToken': make_token(),
            'requestContext': {'authorizer': {'role': 'admin'}}}


def _iso(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


@pytest.fixture
def cc():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        for t in CORE_TABLES + ['900_sendSummary']:
            pk = PK.get(t, 'processId')
            ddb.create_table(TableName=t,
                             KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
                             AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
                             BillingMode='PAY_PER_REQUEST')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        now = datetime.utcnow()

        # Procesos: uno ATASCADO (Enviando hace 5h), uno reciente (no cuenta), uno terminado.
        res.Table('process').put_item(Item={
            'processId': 'p-stuck', 'customerName': 'Beta', 'companyTin': '900',
            'campaignName': 'camp1', 'processState': 'Enviando', 'date': _iso(now - timedelta(hours=5))})
        res.Table('process').put_item(Item={
            'processId': 'p-fresh', 'customerName': 'Beta', 'companyTin': '900',
            'campaignName': 'camp2', 'processState': 'Enviando', 'date': _iso(now - timedelta(minutes=10))})
        res.Table('process').put_item(Item={
            'processId': 'p-done', 'customerName': 'Beta', 'companyTin': '900',
            'campaignName': 'camp3', 'processState': 'Terminado', 'date': _iso(now - timedelta(hours=9))})
        # Reputación: proceso reciente (ventana ÚLTIMOS 7d) y uno viejo (7d anteriores).
        res.Table('process').put_item(Item={
            'processId': 'p-rep-last', 'customerName': 'Beta', 'companyTin': '900',
            'campaignName': 'rep1', 'processState': 'Terminado', 'date': _iso(now - timedelta(days=1))})
        res.Table('process').put_item(Item={
            'processId': 'p-rep-prev', 'customerName': 'Beta', 'companyTin': '900',
            'campaignName': 'rep0', 'processState': 'Terminado', 'date': _iso(now - timedelta(days=10))})
        # Rollup: última ventana 12% de rebote (crítico); la anterior 2% → tendencia 'up'.
        res.Table('900_sendSummary').put_item(Item={
            'processId': 'p-rep-last', 'enviados': 100, 'rebotes': 12, 'quejas': 0})
        res.Table('900_sendSummary').put_item(Item={
            'processId': 'p-rep-prev', 'enviados': 100, 'rebotes': 2, 'quejas': 0})

        # Schedule fallido.
        res.Table('scheduledSend').put_item(Item={
            'scheduleId': 's-fail', 'customerId': 'CU1', 'campaignName': 'campX',
            'status': 'failed', 'scheduledAt': _iso(now - timedelta(hours=1)), 'error': 'boom'})
        res.Table('scheduledSend').put_item(Item={
            'scheduleId': 's-ok', 'customerId': 'CU1', 'status': 'pending',
            'scheduledAt': _iso(now + timedelta(hours=1))})

        # Dinero: débito HOY, recarga aprobada HOY, solicitud pendiente (cualquier fecha).
        today = now.strftime('%Y-%m-%d %H:%M:%S')
        old = (now - timedelta(days=3)).strftime('%Y-%m-%d %H:%M:%S')
        res.Table('walletTransaction').put_item(Item={
            'txId': 't1', 'customerId': 'CU1', 'type': 'debit_send', 'amount': -50000,
            'status': 'approved', 'createdAt': today})
        res.Table('walletTransaction').put_item(Item={
            'txId': 't2', 'customerId': 'CU1', 'type': 'topup_wompi', 'amount': 200000,
            'status': 'approved', 'createdAt': today})
        res.Table('walletTransaction').put_item(Item={
            'txId': 't3', 'customerId': 'CU2', 'type': 'topup_manual', 'amount': 80000,
            'status': 'pending', 'createdAt': old})
        res.Table('walletTransaction').put_item(Item={
            'txId': 't4', 'customerId': 'CU1', 'type': 'debit_send', 'amount': -99999,
            'status': 'approved', 'createdAt': old})  # NO es de hoy
        res.Table('customerBalance').put_item(Item={'customerId': 'CU1', 'balance': 300000})
        res.Table('customerBalance').put_item(Item={'customerId': 'CU2', 'balance': 150000})

        # Auditoría reciente.
        res.Table('adminAudit').put_item(Item={
            'auditId': 'a1', 'action': 'customer.realSend', 'actor': 'admin@mc.co',
            'target': 'Beta', 'detail': 'x', 'date': today})

        # Colas: una del pipeline con su DLQ CON un mensaje (crítico).
        sqs = boto3.client('sqs', region_name='us-east-1')
        sqs.create_queue(QueueName='Sms_Send-batch')
        dlq = sqs.create_queue(QueueName='Sms_Send-batch-dlq')['QueueUrl']
        sqs.send_message(QueueUrl=dlq, MessageBody='veneno')

        yield _load()


def test_gate_admin(cc):
    assert cc.lambda_handler({'requestContext': {'authorizer': {'role': 'admin'}}}, None)['statusCode'] == 403
    assert cc.lambda_handler({}, None)['statusCode'] == 403


def test_pipeline_detecta_atascados_y_fallidos(cc):
    data = cc.lambda_handler(_admin(), None)['data']
    stuck = data['pipeline']['stuckProcesses']
    assert [p['processId'] for p in stuck] == ['p-stuck']  # el fresco y el terminado no
    assert stuck[0]['hoursStuck'] >= 5
    failed = data['pipeline']['failedSchedules']
    assert len(failed) == 1 and failed[0]['scheduleId'] == 's-fail'


def test_pipeline_dlq_con_mensaje_es_critico(cc):
    data = cc.lambda_handler(_admin(), None)['data']
    sms = next(q for q in data['pipeline']['queues'] if q['queue'] == 'Sms_Send-batch')
    assert sms['dlqDepth'] == 1
    assert sms['level'] == 'critical'


def test_dinero_del_dia(cc):
    money = cc.lambda_handler(_admin(), None)['data']['money']
    assert money['todayDebits'] == 50000        # el débito viejo no cuenta
    assert money['todayDebitsCount'] == 1
    assert money['todayTopups'] == 200000
    assert money['pendingTopups'] == {'count': 1, 'amount': 80000}
    assert money['platformBalance'] == 450000


def test_reputacion_top_con_tendencia(cc):
    top = cc.lambda_handler(_admin(), None)['data']['reputation']['top']
    assert len(top) == 1
    beta = top[0]
    assert beta['company'] == 'Beta'
    assert beta['level'] == 'critical'          # 12% de rebote > 10%
    assert beta['trend'] == 'up'                # empeoró frente al 2% previo
    assert abs(beta['bounceRate'] - 0.12) < 1e-6


def test_salud_de_servicios(cc):
    services = cc.lambda_handler(_admin(), None)['data']['health']['services']
    by_name = {s['service']: s for s in services}
    assert by_name['DynamoDB (tablas núcleo)']['status'] == 'ok'
    assert 'SES (correo)' in by_name            # moto responde la cuota
    # Solo 1 de las 9 colas existe en el fixture → advertencia, no error.
    assert by_name['SQS (colas del pipeline)']['status'] == 'warning'


def test_auditoria_reciente(cc):
    audit = cc.lambda_handler(_admin(), None)['data']['audit']
    assert len(audit) == 1 and audit[0]['action'] == 'customer.realSend'
