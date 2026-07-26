"""
Pruebas del PANEL DE SALUD DE DESPLIEGUE (Api_V1_Admin_Deployment-health, Bloque K):
gate admin, verificación de tablas (ACTIVE/faltante), colas (existe/falta) y el resumen
por estado. Las lambdas no se pueden crear con moto de forma trivial, así que el chequeo
de lambdas se ejercita indirectamente (queda 'unknown' sin acceso → no penaliza).
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
from helpers_auth import make_token  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
LAMBDA = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Admin_Deployment-health' / 'lambda_function.py'


def _load():
    spec = importlib.util.spec_from_file_location('deploy_health', str(LAMBDA))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _admin():
    return {'body': None, 'authToken': make_token(),
            'requestContext': {'authorizer': {'role': 'admin'}}}


def _mk_table(name):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name, KeySchema=[{'AttributeName': 'id', 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': 'id', 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


def _sections(resp):
    return {s['key']: s for s in resp['data']['sections']}


def test_requiere_admin():
    with mock_aws():
        m = _load()
        resp = m.lambda_handler({'requestContext': {'authorizer': {'role': 'client'}}}, None)
        assert resp['statusCode'] == 403


def test_tabla_faltante_marca_missing():
    with mock_aws():
        m = _load()
        # Solo creamos algunas tablas núcleo; el resto debe salir 'missing'.
        for t in ('user', 'customer', 'campaign'):
            _mk_table(t)
        resp = m.lambda_handler(_admin(), None)
        assert resp['statusCode'] == 200
        tables = _sections(resp)['tables']
        by_name = {it['name']: it for it in tables['items']}
        assert by_name['user']['status'] == 'ok'
        assert by_name['process']['status'] == 'missing'
        assert tables['level'] in ('warning', 'error')


def test_ondemand_faltante_no_penaliza():
    with mock_aws():
        m = _load()
        resp = m.lambda_handler(_admin(), None)
        by_name = {it['name']: it for it in _sections(resp)['tables']['items']}
        # notificationLog / assistantRateLimit ausentes → status ok (se crean on-demand).
        assert by_name['notificationLog']['status'] == 'ok'
        assert 'on-demand' in by_name['notificationLog']['detail']


def test_colas_faltantes_y_existentes():
    with mock_aws():
        m = _load()
        sqs = boto3.client('sqs', region_name='us-east-1')
        sqs.create_queue(QueueName='Sms_Send-batch')
        sqs.create_queue(QueueName='Sms_Send-batch-dlq')
        resp = m.lambda_handler(_admin(), None)
        queues = _sections(resp)['queues']
        by_name = {it['name']: it for it in queues['items']}
        assert by_name['Sms_Send-batch']['status'] == 'ok'
        assert by_name['Sms_Send-batch-dlq']['status'] == 'ok'
        assert by_name['Voice_Send-batch']['status'] == 'missing'


def test_resumen_cuenta_por_estado():
    with mock_aws():
        m = _load()
        _mk_table('user')
        resp = m.lambda_handler(_admin(), None)
        summary = resp['data']['summary']
        # Hay tablas faltantes → error > 0; el resumen suma todos los ítems.
        assert summary['error'] > 0
        total = summary['ok'] + summary['error'] + summary['warning'] + summary['unknown']
        items = sum(len(s['items']) for s in resp['data']['sections'])
        assert total == items
