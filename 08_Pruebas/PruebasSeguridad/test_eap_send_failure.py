"""
EAP registra los FALLOS de envío por destinatario (antes los tragaba con solo print(e) → pérdida
SILENCIOSA en el canal de documentos personalizados). Un `send_raw_email` que lanza escribe ahora
una fila state=3 (Reject) en {tenant}_sendStatus con un messageId SINTÉTICO (para que Statistics
—que agrega por messageId y descarta las filas sin él— lo cuente como rechazo). El ÉXITO NO se
registra aquí: lo reporta SES por evento (Email_ReceptionStatus) con el messageId real →
registrarlo aquí lo duplicaría.
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
EAP_PATH = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Email_Send-batch-template-EAP' / 'lambda_function.py'
TENANT = '900123'


def _load():
    spec = importlib.util.spec_from_file_location('eap_fail_mod', str(EAP_PATH))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _mk_sendstatus():
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=f'{TENANT}_sendStatus',
        KeySchema=[{'AttributeName': 'processId', 'KeyType': 'HASH'},
                   {'AttributeName': 'sendStatusId', 'KeyType': 'RANGE'}],
        AttributeDefinitions=[{'AttributeName': 'processId', 'AttributeType': 'S'},
                              {'AttributeName': 'sendStatusId', 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


def _items():
    return boto3.resource('dynamodb', region_name='us-east-1').Table(f'{TENANT}_sendStatus').scan()['Items']


def test_fallo_por_destinatario_queda_registrado_state3():
    with mock_aws():
        _mk_sendstatus()
        eap = _load()
        eap._record_send_failure(TENANT, 'P1', 5, 'uid1', 'a@x.com',
                                 RuntimeError('SES throttled'), '2026-01-01T00:00:00Z')
        items = _items()
        assert len(items) == 1
        row = items[0]
        assert int(row['state']) == 3                 # Reject (mismo mapa que ReceptionStatus/SMS)
        assert row['email'] == 'a@x.com'
        assert row['uniqueId'] == 'uid1'
        assert row.get('messageId'), 'debe llevar messageId para que Statistics lo cuente'
        assert 'throttled' in row['type2']


def test_fallo_es_idempotente_por_part_y_uid():
    """Reproceso (misma part, uniqueId): la clave determinista SOBRESCRIBE la misma fila → no
    se duplica el rechazo en el reporte."""
    with mock_aws():
        _mk_sendstatus()
        eap = _load()
        for _ in range(3):
            eap._record_send_failure(TENANT, 'P1', 5, 'uid1', 'a@x.com', RuntimeError('x'), 'd')
        assert len(_items()) == 1
        # Dos destinatarios distintos del mismo sub-lote → dos filas.
        eap._record_send_failure(TENANT, 'P1', 5, 'uid2', 'b@x.com', RuntimeError('x'), 'd')
        assert len(_items()) == 2


def test_no_rompe_sin_tenant():
    with mock_aws():
        eap = _load()
        # Sin llave de tenant/proceso no se puede escribir; best-effort (no lanza).
        eap._record_send_failure('', 'P1', 5, 'uid1', 'a@x.com', RuntimeError('x'), 'd')
