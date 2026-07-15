"""
Pruebas de la PRE-AGREGACIÓN de contadores (resumen por proceso).

Alimenta una secuencia de eventos por bump_send_summary (write-side de
Api_V1_Email_ReceptionStatus) y verifica que el resumen {customer}_sendSummary
coincide con la agregación por 'estado de mayor prioridad por mensaje' — incluido
el caso en que un mensaje CAMBIA de bucket al avanzar de estado (rebote -> entregado).
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
    spec = importlib.util.spec_from_file_location('sum_' + folder, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def rs():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        ddb.create_table(
            TableName='empresa_sendState',
            KeySchema=[{'AttributeName': 'processId', 'KeyType': 'HASH'},
                       {'AttributeName': 'messageId', 'KeyType': 'RANGE'}],
            AttributeDefinitions=[{'AttributeName': 'processId', 'AttributeType': 'S'},
                                  {'AttributeName': 'messageId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        ddb.create_table(
            TableName='empresa_sendSummary',
            KeySchema=[{'AttributeName': 'processId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'processId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        m = _load('Api_V1_Email_ReceptionStatus')
        m.SEND_SUMMARY_ENABLED = True   # activar la pre-agregación en la prueba
        yield m


def _summary():
    item = boto3.resource('dynamodb', region_name='us-east-1').Table('empresa_sendSummary').get_item(
        Key={'processId': 'P1'}).get('Item') or {}
    return {k: int(item.get(k, 0)) for k in ('enviados', 'entregados', 'abiertos', 'clics', 'rebotes', 'quejas')}


def test_resumen_coincide_con_agregacion(rs):
    # Secuencia de eventos (messageId, estado). Estados: 1 Env, 2 Entr, 3 Reb, 4 Ab, 5 Clic, 7 Queja.
    eventos = [
        ('m1', 1), ('m1', 2), ('m1', 4),   # -> Abierto
        ('m2', 1), ('m2', 3),              # -> Rebote
        ('m3', 1),                         # -> Enviado
        ('m4', 4), ('m4', 1),              # 1 tardío se ignora -> Abierto
        ('m5', 3), ('m5', 2),              # Rebote luego Entregado (cambia de bucket)
        ('m6', 5),                         # -> Clic
        ('m7', 7),                         # -> Queja
    ]
    for mid, st in eventos:
        rs.bump_send_summary('empresa', 'P1', mid, st)

    assert _summary() == {
        'enviados': 7,     # m1..m7
        'entregados': 5,   # m1, m4, m5, m6, m7
        'abiertos': 3,     # m1, m4, m6
        'clics': 1,        # m6
        'rebotes': 1,      # m2 (el de m5 se movió a entregado)
        'quejas': 1,       # m7
    }


def test_evento_repetido_no_duplica(rs):
    # El mismo estado repetido no debe volver a contar (idempotente por mensaje).
    for _ in range(3):
        rs.bump_send_summary('empresa', 'P1', 'm1', 2)
    assert _summary() == {'enviados': 1, 'entregados': 1, 'abiertos': 0, 'clics': 0, 'rebotes': 0, 'quejas': 0}


def test_gated_apagado_no_escribe(rs):
    rs.SEND_SUMMARY_ENABLED = False
    rs.bump_send_summary('empresa', 'P1', 'm1', 4)
    assert _summary() == {'enviados': 0, 'entregados': 0, 'abiertos': 0, 'clics': 0, 'rebotes': 0, 'quejas': 0}
