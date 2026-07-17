"""
Las MUESTRAS (envíos de prueba) NO deben contar en reportes, estadísticas ni facturación
(igual que en el resto del mercado; el monedero prepago tampoco las cobra). Se marcan con
`isSamples=True` en el registro de proceso y los agregados las excluyen.

Esta suite monta una campaña con DOS procesos — uno real y uno de muestra — y verifica que
Statistics (portal), Admin/Dashboard (global + reputación) y Billing (consumo) cuenten SOLO
el proceso real.
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

LAMBDA_FILES = {
    'statistics': 'Api_V1_Reports_Statistics',
    'dashboard': 'Api_V1_Admin_Dashboard',
    'billing': 'Api_V1_Billing_Summary',
}

TENANT = '900'  # tenant_key(companyTin '900')


def _load(name, folder):
    spec = importlib.util.spec_from_file_location(name, str(LAMBDAS / folder / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _pk(ddb, name, pk):
    ddb.create_table(TableName=name, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
                     AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
                     BillingMode='PAY_PER_REQUEST')


def _pk_sk(ddb, name, pk, sk):
    ddb.create_table(TableName=name,
                     KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}, {'AttributeName': sk, 'KeyType': 'RANGE'}],
                     AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}, {'AttributeName': sk, 'AttributeType': 'S'}],
                     BillingMode='PAY_PER_REQUEST')


@pytest.fixture
def mods():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        _pk(ddb, 'campaign', 'campaignId')
        _pk(ddb, 'process', 'processId')
        _pk(ddb, 'customer', 'customerId')
        _pk_sk(ddb, f'{TENANT}_sendStatus', 'processId', 'sendStatusId')

        res.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'empresa', 'companyTin': '900'})
        res.Table('campaign').put_item(Item={
            'campaignId': 'C1', 'customerId': 'CU1', 'campaignName': 'Promo',
            'campaignState': 'Terminada', 'channel': 'EM', 'date': '2026-07-01'})

        # Proceso REAL: 3 mensajes ENTREGADOS (state 2).
        res.Table('process').put_item(Item={
            'processId': 'P_real', 'campaignId': 'C1', 'customerName': 'empresa',
            'campaignName': 'Promo', 'processState': 'Terminada', 'isSamples': False})
        # Proceso de MUESTRA: 2 mensajes REBOTADOS (state 6). NO debe contar en ningún agregado.
        res.Table('process').put_item(Item={
            'processId': 'P_sample', 'campaignId': 'C1', 'customerName': 'empresa',
            'campaignName': 'Promo-Samples', 'processState': 'Muestras', 'isSamples': True})

        st = res.Table(f'{TENANT}_sendStatus')
        for i in range(3):
            st.put_item(Item={'processId': 'P_real', 'sendStatusId': f'r{i}', 'messageId': f'r{i}', 'state': 2})
        for i in range(2):
            st.put_item(Item={'processId': 'P_sample', 'sendStatusId': f's{i}', 'messageId': f's{i}', 'state': 6})

        yield {name: _load(name, folder) for name, folder in LAMBDA_FILES.items()}


def _stats_event():
    return {'requestContext': {'authorizer': {'customerId': 'CU1', 'customer': 'empresa', 'nit': '900'}}}


def _admin_event():
    return {'body': None, 'requestContext': {'authorizer': {'role': 'admin'}}}


def test_statistics_excluye_muestras(mods):
    resp = mods['statistics'].lambda_handler(_stats_event(), None)
    assert resp['statusCode'] == 200
    c1 = next(c for c in resp['data']['campaigns'] if c['id'] == 'C1')
    # Solo el proceso real: 3 enviados/entregados, 0 rebotes (las 2 muestras rebotadas se ignoran).
    assert c1['enviados'] == 3
    assert c1['entregados'] == 3
    assert c1['rebotes'] == 0


def test_dashboard_excluye_muestras_de_kpis_y_reputacion(mods):
    data = mods['dashboard'].lambda_handler(_admin_event(), None)['data']
    # Volumen por canal: solo los 3 reales.
    email = next((b for b in data['byChannel'] if b['channel'] == 'EMAIL'), None)
    assert email is not None and email['sent'] == 3
    # Reputación: las muestras rebotadas NO inflan el bounce rate (0/3, no 2/5).
    salud = next((h for h in data['health'] if h['company'] == 'empresa'), None)
    assert salud is not None
    assert salud['bounceRate'] == 0
    assert salud['level'] == 'ok'


def test_billing_no_factura_muestras(mods):
    data = mods['billing'].lambda_handler(_admin_event(), None)['data']
    row = next((r for r in data['customers'] if r['customerId'] == 'CU1'), None)
    assert row is not None
    # Consumo = solo los 3 reales (las muestras no se facturan).
    assert row['totalSent'] == 3
    assert data['totals']['totalSent'] == 3
