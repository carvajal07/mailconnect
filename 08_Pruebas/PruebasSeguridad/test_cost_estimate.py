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
    # Precio ESCALONADO por volumen: 1.000 correos cae en el tramo base EM = $30 c/u.
    r = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EM', 'recipients': 1000}, None)
    d = r['data']
    assert d['subtotal'] == 30000           # 1000 × 30 (tramo 1k)
    assert d['tax'] == round(30000 * 0.19)
    assert d['estimatedCost'] == 30000 + round(30000 * 0.19)


def test_email_eau_tramo(cost):
    # EAU: el precio del tramo es "todo incluido" ($45 a 1k). El recargo por MB es OPCIONAL
    # (default 0), así que enviar 2 MB no cambia el precio.
    r = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EAU', 'recipients': 1000, 'attachmentSizeMB': 2}, None)
    assert r['data']['subtotal'] == 45000   # 1000 × 45 (tramo EAU 1k)


def test_email_eap_tramo(cost):
    # EAP: precio del tramo "todo incluido" ($60 a 1k). La personalización PDF/DOCX es un
    # recargo OPCIONAL (default 0) → hoy pdf y docx cuestan igual.
    pdf = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EAP', 'recipients': 1000, 'attachmentType': 'pdf'}, None)['data']
    docx = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EAP', 'recipients': 1000, 'attachmentType': 'docx'}, None)['data']
    assert pdf['subtotal'] == 60000 and docx['subtotal'] == 60000   # 1000 × 60


def test_sms_segmentos(cost):
    uno = cost.lambda_handler({'channel': 'SMS', 'recipients': 1000}, None)['data']
    dos = cost.lambda_handler({'channel': 'SMS', 'recipients': 1000, 'smsSegments': 2}, None)['data']
    assert uno['subtotal'] == 55000 and dos['subtotal'] == 110000   # 1000×55 ; ×2 segmentos


def test_whatsapp_y_voz(cost):
    wsp = cost.lambda_handler({'channel': 'WHATSAPP', 'recipients': 1000}, None)['data']
    voz = cost.lambda_handler({'channel': 'VOICE', 'recipients': 1000, 'voiceMinutes': 1}, None)['data']
    assert wsp['subtotal'] == 130000      # 1000 × 130 (tramo WhatsApp 1k)
    assert voz['subtotal'] == 150000      # 1000 × 150/min × 1 min (tramo Voz 1k)


def test_precio_baja_con_volumen(cost):
    # El unitario del TRAMO baja al subir el volumen (economía de escala).
    chico = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EM', 'recipients': 1000}, None)['data']
    grande = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EM', 'recipients': 1000000}, None)['data']
    assert chico['unitCost'] == 30 and grande['unitCost'] == 4   # 30 (1k) → 4 (1M)
    # 50.000 correos cae en el tramo de 50k → $19 c/u.
    medio = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EM', 'recipients': 50000}, None)['data']
    assert medio['unitCost'] == 19


def test_online_onfile_mismo_precio_por_ahora(cost):
    # El modo de entrega (attachmentDelivery ONFILE/ONLINE) se acepta; con ONLINE_FACTOR=1.0
    # cobra igual (hook listo para diferenciar después).
    onfile = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EAP', 'recipients': 1000, 'attachmentDelivery': 'ONFILE'}, None)['data']
    online = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EAP', 'recipients': 1000, 'attachmentDelivery': 'ONLINE'}, None)['data']
    assert onfile['subtotal'] == online['subtotal'] == 60000


def test_minimo_por_campana(cost):
    d = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EM', 'recipients': 10}, None)['data']
    assert d['appliedMinimum'] is True
    assert d['subtotal'] == 5000          # se eleva al mínimo


def test_override_por_cliente(cost):
    # CU1 tiene baseEM=20 en la tabla (vs 8 por defecto).
    d = cost.lambda_handler({'channel': 'EMAIL', 'emailMode': 'EM', 'recipients': 1000, 'customerId': 'CU1'}, None)['data']
    assert d['subtotal'] == 20000


def test_customer_id_sale_del_token_no_del_body(cost):
    # Seguridad: el customerId del TOKEN (Authorizer) manda sobre el del body. Si un
    # cliente 'sin override' intenta usar el customerId de CU1 (baseEM=20) en el body,
    # se ignora y se aplica su propia tarifa (el tramo por volumen: $30 a 1k).
    ev = {
        'requestContext': {'authorizer': {'customerId': 'OTRO'}},
        'body': {'channel': 'EMAIL', 'emailMode': 'EM', 'recipients': 1000, 'customerId': 'CU1'},
    }
    d = cost.lambda_handler(ev, None)['data']
    assert d['subtotal'] == 30000   # tramo de OTRO (sin override), NO la tarifa de CU1 (20)


def test_errores(cost):
    assert cost.lambda_handler({'channel': 'EMAIL', 'recipients': 0}, None)['statusCode'] == 400
    assert cost.lambda_handler({'channel': 'FAX', 'recipients': 10}, None)['statusCode'] == 400
