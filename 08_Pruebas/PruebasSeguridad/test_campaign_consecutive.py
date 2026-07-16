"""
Pruebas del consecutivo ATÓMICO de campañas (next_consecutive): garantiza números únicos
por cliente sin carrera, sembrando desde el valor legado y con fallback si falta la tabla.
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


def _load():
    p = DIR / 'Api_V1_Campaign_Create-campaign' / 'lambda_function.py'
    spec = importlib.util.spec_from_file_location('cc_mod', str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _pk(name, pk):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}], BillingMode='PAY_PER_REQUEST')


def test_consecutivo_arranca_en_0001():
    with mock_aws():
        _pk('campaignCounter', 'customerId')
        _pk('campaignControl', 'campaignControlId')
        mod = _load()
        assert mod.next_consecutive('CU1') == '0001'
        assert mod.next_consecutive('CU1') == '0002'   # atómico → distinto


def test_dos_clientes_no_se_pisan():
    with mock_aws():
        _pk('campaignCounter', 'customerId')
        _pk('campaignControl', 'campaignControlId')
        mod = _load()
        assert mod.next_consecutive('CU1') == '0001'
        assert mod.next_consecutive('CU2') == '0001'   # contador por cliente
        assert mod.next_consecutive('CU1') == '0002'


def test_siembra_desde_el_valor_legado():
    # Un cliente con consecutivo previo en campaignControl (0007) NO debe reiniciarse: el
    # contador se siembra desde ahí y el siguiente es 0008 (no colisiona con lo ya creado).
    with mock_aws():
        _pk('campaignCounter', 'customerId')
        _pk('campaignControl', 'campaignControlId')
        boto3.resource('dynamodb', region_name='us-east-1').Table('campaignControl').put_item(
            Item={'campaignControlId': 'ctrl1', 'customerId': 'CU9', 'numeration': '0007'})
        mod = _load()
        assert mod.next_consecutive('CU9') == '0008'
        assert mod.next_consecutive('CU9') == '0009'


def test_fallback_sin_tabla_contador():
    # Sin campaignCounter (no provisionada aún) cae al método legado y sigue operando.
    with mock_aws():
        _pk('campaignControl', 'campaignControlId')   # solo la vieja
        mod = _load()
        assert mod.next_consecutive('CU1') == '0001'
        # El legado escribe en campaignControl → el segundo lee 0001 y da 0002.
        assert mod.next_consecutive('CU1') == '0002'
