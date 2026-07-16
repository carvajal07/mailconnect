"""
Pruebas del panel de control global admin (Admin/Dashboard): gating, KPIs macro,
embudo, desglose por canal y salud de envíos (niveles ok/warning/critical).
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
    spec = importlib.util.spec_from_file_location('dash_' + folder, str(p))
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


def _put_states(table, process_id, prefix, states):
    for i, st in enumerate(states):
        table.put_item(Item={'processId': process_id, 'sendStatusId': f'{prefix}{i}', 'messageId': f'{prefix}{i}', 'state': st})


# Las tablas de estados por cliente se nombran por NIT saneado (tenant_key(companyTin)).
# El display sigue mostrando el nombre de empresa (company).
@pytest.fixture
def dash():
    with mock_aws():
        _pk('customer', 'customerId')
        _pk('campaign', 'campaignId')
        _pk('process', 'processId')
        _pk_sk('111_sendStatus', 'processId', 'sendStatusId')   # Acme (companyTin 111)
        _pk_sk('222_sendStatus', 'processId', 'sendStatusId')   # Bad (companyTin 222)
        ddb = boto3.resource('dynamodb', region_name='us-east-1')
        ddb.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'Acme', 'companyTin': '111'})
        ddb.Table('customer').put_item(Item={'customerId': 'CU2', 'company': 'Bad', 'companyTin': '222'})
        # Sin actividad (no debe salir en salud ni sumar envíos).
        ddb.Table('customer').put_item(Item={'customerId': 'CU3', 'company': 'Idle', 'companyTin': '333'})
        ddb.Table('campaign').put_item(Item={'campaignId': 'CA1', 'customerId': 'CU1', 'channel': 'EM', 'campaignState': 'Enviando', 'date': '2026-07-01'})
        ddb.Table('campaign').put_item(Item={'campaignId': 'CA2', 'customerId': 'CU2', 'channel': 'EM', 'campaignState': 'Terminada', 'date': '2026-06-01'})
        ddb.Table('process').put_item(Item={'processId': 'P1', 'customerName': 'Acme', 'campaignId': 'CA1'})
        ddb.Table('process').put_item(Item={'processId': 'P2', 'customerName': 'Bad', 'campaignId': 'CA2'})
        # Acme: 20 envíos sanos (18 entregados, 2 abiertos), 0 rebotes.
        _put_states(ddb.Table('111_sendStatus'), 'P1', 'a', [2] * 18 + [4, 4])
        # Bad: 10 envíos, 2 rebotes (6) + 1 queja (7) → tasas altas = crítico.
        _put_states(ddb.Table('222_sendStatus'), 'P2', 'b', [2] * 7 + [6, 6, 7])
        yield _load('Api_V1_Admin_Dashboard')


def test_requiere_admin(dash):
    assert dash.lambda_handler({'requestContext': {'authorizer': {'role': 'client'}}}, None)['statusCode'] == 403


def test_kpis_globales(dash):
    resp = dash.lambda_handler(_admin(), None)
    assert resp['statusCode'] == 200
    k = resp['data']['kpis']
    assert k['customers'] == 3
    assert k['activeCampaigns'] == 1   # CA1 Enviando
    assert k['totalSent'] == 30        # 20 + 10
    assert k['delivered'] == 28        # 20 (Acme) + 8 (Bad: 7 entregados + 1 queja)
    assert k['atRisk'] == 1            # Bad


def test_embudo_y_por_canal(dash):
    data = dash.lambda_handler(_admin(), None)['data']
    funnel = {s['label']: s['value'] for s in data['funnel']}
    assert funnel['Enviados'] == 30 and funnel['Abiertos'] == 2
    # Ambas campañas son correo → un solo canal EMAIL con 30 envíos.
    assert data['byChannel'] == [{'channel': 'EMAIL', 'label': 'Correo', 'sent': 30}]


def test_salud_ordena_riesgo_primero(dash):
    health = dash.lambda_handler(_admin(), None)['data']['health']
    # Solo Acme y Bad (Idle no tiene envíos). Bad (crítico) va primero.
    assert [h['company'] for h in health] == ['Bad', 'Acme']
    assert health[0]['level'] == 'critical'
    assert health[1]['level'] == 'ok'
    assert health[0]['bounceRate'] == 0.2   # 2/10


def test_filtro_por_mes(dash):
    # Julio: solo CA1 (Acme). Bad queda fuera → sin clientes en riesgo.
    data = dash.lambda_handler(_admin({'month': '2026-07'}), None)['data']
    assert data['kpis']['totalSent'] == 20
    assert data['kpis']['atRisk'] == 0
    assert [h['company'] for h in data['health']] == ['Acme']
