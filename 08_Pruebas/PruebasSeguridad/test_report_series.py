"""
Pruebas de la serie temporal del cliente (Report/Series): serie diaria CONTINUA de los
últimos N días leída del rollup {tenant}_sendSummary, exclusión de muestras, aislamiento
por tenant, aproximación para procesos sin rollup (withoutRollup) y clamp de `days`.
"""
import os
import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DIR = REPO_ROOT / '04_Backend' / 'lambdas'


def _load():
    p = DIR / 'Api_V1_Reports_Series' / 'lambda_function.py'
    spec = importlib.util.spec_from_file_location('report_series', str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _pk(name, pk):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}], BillingMode='PAY_PER_REQUEST')


def _event(payload=None, customer='Acme', nit='111'):
    auth = {}
    if customer:
        auth['customer'] = customer
    if nit:
        auth['nit'] = nit
    return {'requestContext': {'authorizer': auth}, **(payload or {})}


def _day(offset):
    """Fecha YYYY-MM-DD de hace `offset` días (UTC, como la lambda)."""
    return (datetime.now(timezone.utc) - timedelta(days=offset)).strftime('%Y-%m-%d')


def _proc(pid, day_offset, customer='Acme', **extra):
    return {'processId': pid, 'customerName': customer,
            'date': _day(day_offset) + 'T10:00:00.000Z', **extra}


@pytest.fixture
def env():
    with mock_aws():
        _pk('process', 'processId')
        _pk('111_sendSummary', 'processId')
        yield _load()


def test_403_sin_identidad(env):
    resp = env.lambda_handler(_event(customer=None, nit=None), None)
    assert resp['statusCode'] == 403


def test_serie_continua_con_ceros(env):
    # Sin procesos: 30 días continuos, todos en cero, con from/to correctos.
    resp = env.lambda_handler(_event(), None)
    assert resp['statusCode'] == 200
    d = resp['data']
    assert len(d['days']) == 30
    assert d['days'][0]['date'] == _day(29) and d['days'][-1]['date'] == _day(0)
    assert d['from'] == _day(29) and d['to'] == _day(0)
    assert all(row['enviados'] == 0 and row['entregados'] == 0 for row in d['days'])
    assert d['totals']['enviados'] == 0 and d['withoutRollup'] == 0


def test_bucketea_por_dia_desde_el_rollup(env):
    ddb = boto3.resource('dynamodb', region_name='us-east-1')
    # Dos procesos el mismo día (se suman) + uno en otro día.
    ddb.Table('process').put_item(Item=_proc('P1', 3))
    ddb.Table('process').put_item(Item=_proc('P2', 3))
    ddb.Table('process').put_item(Item=_proc('P3', 5))
    summ = ddb.Table('111_sendSummary')
    summ.put_item(Item={'processId': 'P1', 'enviados': 10, 'entregados': 9, 'abiertos': 4, 'clics': 1, 'rebotes': 1, 'quejas': 0})
    summ.put_item(Item={'processId': 'P2', 'enviados': 5, 'entregados': 5, 'abiertos': 2, 'clics': 0, 'rebotes': 0, 'quejas': 0})
    summ.put_item(Item={'processId': 'P3', 'enviados': 7, 'entregados': 6, 'abiertos': 0, 'clics': 0, 'rebotes': 0, 'quejas': 1})

    d = env.lambda_handler(_event(), None)['data']
    by_date = {row['date']: row for row in d['days']}
    dia3 = by_date[_day(3)]
    assert dia3['enviados'] == 15 and dia3['entregados'] == 14 and dia3['abiertos'] == 6 and dia3['clics'] == 1
    dia5 = by_date[_day(5)]
    assert dia5['enviados'] == 7 and dia5['quejas'] == 1
    assert d['totals'] == {'enviados': 22, 'entregados': 20, 'abiertos': 6, 'clics': 1, 'rebotes': 1, 'quejas': 1}
    assert d['withoutRollup'] == 0


def test_excluye_muestras(env):
    ddb = boto3.resource('dynamodb', region_name='us-east-1')
    ddb.Table('process').put_item(Item=_proc('P1', 2, isSamples=True))
    ddb.Table('process').put_item(Item=_proc('P2', 2, processState='Muestras'))
    ddb.Table('111_sendSummary').put_item(Item={'processId': 'P1', 'enviados': 99})
    d = env.lambda_handler(_event(), None)['data']
    assert d['totals']['enviados'] == 0


def test_solo_procesos_del_tenant(env):
    ddb = boto3.resource('dynamodb', region_name='us-east-1')
    ddb.Table('process').put_item(Item=_proc('P1', 2, customer='Otra Empresa'))
    ddb.Table('111_sendSummary').put_item(Item={'processId': 'P1', 'enviados': 50})
    d = env.lambda_handler(_event(), None)['data']
    assert d['totals']['enviados'] == 0


def test_sin_rollup_aproxima_por_registers(env):
    # Un proceso SIN fila de resumen aporta registersToSend como enviados y cuenta
    # en withoutRollup (histórico previo al backfill de la preagregación).
    ddb = boto3.resource('dynamodb', region_name='us-east-1')
    ddb.Table('process').put_item(Item=_proc('P1', 4, registersToSend=120))
    d = env.lambda_handler(_event(), None)['data']
    by_date = {row['date']: row for row in d['days']}
    assert by_date[_day(4)]['enviados'] == 120
    assert by_date[_day(4)]['entregados'] == 0   # aproximación: solo enviados
    assert d['withoutRollup'] == 1


def test_fuera_del_rango_no_cuenta(env):
    ddb = boto3.resource('dynamodb', region_name='us-east-1')
    ddb.Table('process').put_item(Item=_proc('P1', 45))   # hace 45 días (fuera de 30)
    ddb.Table('111_sendSummary').put_item(Item={'processId': 'P1', 'enviados': 33})
    d = env.lambda_handler(_event(), None)['data']
    assert d['totals']['enviados'] == 0
    # ... pero con days=90 sí entra.
    d90 = env.lambda_handler(_event({'days': 90}), None)['data']
    assert len(d90['days']) == 90
    assert d90['totals']['enviados'] == 33


def test_days_se_acota_a_90(env):
    d = env.lambda_handler(_event({'days': 500}), None)['data']
    assert len(d['days']) == 90
    d7 = env.lambda_handler(_event({'days': 7}), None)['data']
    assert len(d7['days']) == 7
    # Valor inválido → default 30.
    dbad = env.lambda_handler(_event({'days': 'xx'}), None)['data']
    assert len(dbad['days']) == 30
