"""
Pruebas del estimador de costos (Api_V1_Cost_Estimate), los 4 canales.
Local con moto: valida los defaults y el override por tabla pricingRate.
"""
import os
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from decimal import Decimal  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
COST_PATH = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Cost_Estimate' / 'lambda_function.py'


def _load():
    spec = importlib.util.spec_from_file_location('cost_mod', str(COST_PATH))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture(scope="module")
def cost():
    with mock_aws():
        # Tabla pricingRate (PK customerId, SK channel) con un override para un cliente.
        boto3.client('dynamodb', region_name='us-east-1').create_table(
            TableName='pricingRate',
            KeySchema=[{'AttributeName': 'customerId', 'KeyType': 'HASH'},
                       {'AttributeName': 'channel', 'KeyType': 'RANGE'}],
            AttributeDefinitions=[{'AttributeName': 'customerId', 'AttributeType': 'S'},
                                  {'AttributeName': 'channel', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        boto3.resource('dynamodb', region_name='us-east-1').Table('pricingRate').put_item(
            Item={'customerId': 'CU1', 'channel': 'EMAIL', 'baseEM': Decimal('20'), 'taxRate': Decimal('0.19')})
        yield _load()


def test_email_em_defaults(cost):
    r = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EM', 'recipients': 1000}, None)
    d = r['data']
    assert d['subtotal'] == 8000            # 1000 × 8
    assert d['tax'] == round(8000 * 0.19)
    assert d['estimatedCost'] == 8000 + round(8000 * 0.19)


def test_email_eau_recargo_peso(cost):
    r = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EAU', 'recipients': 1000, 'attachmentSizeMB': 2}, None)
    # 1000 × (15 base + 2MB×5) = 1000 × 25 = 25000
    assert r['data']['subtotal'] == 25000


def test_email_eap_pdf_vs_docx(cost):
    pdf = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EAP', 'recipients': 1000, 'attachmentType': 'pdf'}, None)['data']
    docx = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EAP', 'recipients': 1000, 'attachmentType': 'docx'}, None)['data']
    # PDF: 40+25=65 ; DOCX: 40+35=75 → docx cuesta más
    assert pdf['subtotal'] == 65000 and docx['subtotal'] == 75000


def test_sms_segmentos(cost):
    uno = cost.lambda_handler({'channel': 'SMS', 'recipients': 1000}, None)['data']
    dos = cost.lambda_handler({'channel': 'SMS', 'recipients': 1000, 'smsSegments': 2}, None)['data']
    assert uno['subtotal'] == 60000 and dos['subtotal'] == 120000


def test_whatsapp_y_voz(cost):
    wsp = cost.lambda_handler({'channel': 'WHATSAPP', 'recipients': 1000}, None)['data']
    voz = cost.lambda_handler({'channel': 'VOICE', 'recipients': 1000, 'voiceMinutes': 1}, None)['data']
    assert wsp['subtotal'] == 90000       # 1000 × 90
    assert voz['subtotal'] == 120000      # 1000 × 120/min × 1 min


def test_minimo_por_campana(cost):
    d = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EM', 'recipients': 10}, None)['data']
    assert d['appliedMinimum'] is True
    assert d['subtotal'] == 5000          # se eleva al mínimo


def test_override_por_cliente(cost):
    # CU1 tiene baseEM=20 en la tabla (vs 8 por defecto).
    d = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EM', 'recipients': 1000, 'customerId': 'CU1'}, None)['data']
    assert d['subtotal'] == 20000


def test_errores(cost):
    assert cost.lambda_handler({'channel': 'EMAIL', 'recipients': 0}, None)['statusCode'] == 400
    assert cost.lambda_handler({'channel': 'FAX', 'recipients': 10}, None)['statusCode'] == 400
