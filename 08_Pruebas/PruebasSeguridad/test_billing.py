"""
Pruebas del resumen de facturación admin (Billing/Summary): gating admin, conteo
de envíos por canal, aplicación de tarifas e IVA, mínimo por campaña y filtro por mes.
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
    spec = importlib.util.spec_from_file_location('bill_' + folder, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _admin(payload):
    return {'body': None, 'requestContext': {'authorizer': {'role': 'admin'}}, **payload}


def _pk(name, pk):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name,
        KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


def _pk_sk(name, pk, sk):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name,
        KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}, {'AttributeName': sk, 'KeyType': 'RANGE'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}, {'AttributeName': sk, 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


@pytest.fixture
def billing():
    with mock_aws():
        _pk('customer', 'customerId')
        _pk('campaign', 'campaignId')
        _pk('process', 'processId')
        # Estados por cliente nombrados por NIT saneado (tenant_key('900')='900').
        _pk_sk('900_sendStatus', 'processId', 'sendStatusId')
        _pk_sk('pricingRate', 'customerId', 'channel')
        ddb = boto3.resource('dynamodb', region_name='us-east-1')
        ddb.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'Acme', 'companyTin': '900'})
        # CA1: correo simple (EM) en julio; CA2: SMS en junio.
        ddb.Table('campaign').put_item(Item={'campaignId': 'CA1', 'customerId': 'CU1', 'channel': 'EM', 'campaignName': 'Julio', 'date': '2026-07-01'})
        ddb.Table('campaign').put_item(Item={'campaignId': 'CA2', 'customerId': 'CU1', 'channel': 'SMS', 'campaignName': 'Junio', 'date': '2026-06-01'})
        ddb.Table('process').put_item(Item={'processId': 'P1', 'customerName': 'Acme', 'campaignId': 'CA1'})
        ddb.Table('process').put_item(Item={'processId': 'P2', 'customerName': 'Acme', 'campaignId': 'CA2'})
        st = ddb.Table('900_sendStatus')
        # P1 (EM): 3 mensajes; P2 (SMS): 2 mensajes.
        for i, m in enumerate(['m1', 'm2', 'm3']):
            st.put_item(Item={'processId': 'P1', 'sendStatusId': f's{i}', 'messageId': m, 'state': 1})
        for i, m in enumerate(['m4', 'm5']):
            st.put_item(Item={'processId': 'P2', 'sendStatusId': f't{i}', 'messageId': m, 'state': 1})
        # Tarifas: minCampaign 0 para poder verificar la aritmética unitaria limpia.
        ddb.Table('pricingRate').put_item(Item={'customerId': '*', 'channel': 'EMAIL', 'minCampaign': 0})
        ddb.Table('pricingRate').put_item(Item={'customerId': '*', 'channel': 'SMS', 'minCampaign': 0})
        yield _load('Api_V1_Billing_Summary')


def test_requiere_admin(billing):
    resp = billing.lambda_handler({'requestContext': {'authorizer': {'role': 'client'}}}, None)
    assert resp['statusCode'] == 403


def test_suma_por_canal_y_tarifa(billing):
    resp = billing.lambda_handler(_admin({}), None)
    assert resp['statusCode'] == 200
    rows = resp['data']['customers']
    assert len(rows) == 1
    acme = rows[0]
    assert acme['totalSent'] == 5  # 3 EM + 2 SMS
    by = {c['channel']: c for c in acme['byChannel']}
    assert by['EM']['sent'] == 3 and by['EM']['amount'] == 90     # 3 × 30 (tramo EM 1k)
    assert by['SMS']['sent'] == 2 and by['SMS']['amount'] == 110  # 2 × 55 (tramo SMS 1k)
    assert acme['subtotal'] == 200
    assert acme['tax'] == 38   # round(200 × 0.19)
    assert acme['total'] == 238


def test_filtro_por_mes(billing):
    resp = billing.lambda_handler(_admin({'month': '2026-07'}), None)
    acme = resp['data']['customers'][0]
    # Solo la campaña de julio (EM) entra.
    assert acme['totalSent'] == 3
    assert [c['channel'] for c in acme['byChannel']] == ['EM']


def test_minimo_por_campana(billing):
    # Sin override de minCampaign, aplica el mínimo (5000) por campaña.
    ddb = boto3.resource('dynamodb', region_name='us-east-1')
    ddb.Table('pricingRate').delete_item(Key={'customerId': '*', 'channel': 'EMAIL'})
    ddb.Table('pricingRate').delete_item(Key={'customerId': '*', 'channel': 'SMS'})
    resp = billing.lambda_handler(_admin({'month': '2026-07'}), None)
    acme = resp['data']['customers'][0]
    # 3 × 8 = 24 < 5000 → se cobra el mínimo.
    assert acme['subtotal'] == 5000


def test_filtro_por_cliente_inexistente_vacio(billing):
    resp = billing.lambda_handler(_admin({'customerId': 'NOPE'}), None)
    assert resp['statusCode'] == 200
    assert resp['data']['customers'] == []
    assert resp['data']['totals']['total'] == 0
