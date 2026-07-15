"""
Pruebas de las lambdas de listados, estadísticas, refresh-token y del multi-tenant
(Authorizer devolviendo el customerId en el context).

100% local con moto (DynamoDB + SES). Independientes de test_seguridad.py.
"""
import os
import importlib.util
from pathlib import Path

# Entorno para moto/JWT ANTES de importar las lambdas.
os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')
os.environ.setdefault('SECRET_KEY', 'test-secret-key-para-pruebas-32bytes!')

from datetime import datetime, timedelta  # noqa: E402
import jwt  # noqa: E402
import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
LAMBDAS_DIR = REPO_ROOT / '04_Backend' / 'lambdas'

LAMBDA_FILES = {
    'campaign_list': 'Api_V1_Campaign_List',
    'template_list': 'Api_V1_Template_List',
    'database_list': 'Api_V1_Database_List',
    'statistics': 'Api_V1_Reports_Statistics',
    'refresh': 'Api_V1_Security_Refresh-token',
    'authorizer': 'Authorizer',
}


def _load(name, folder):
    path = LAMBDAS_DIR / folder / 'lambda_function.py'
    spec = importlib.util.spec_from_file_location(f"mc2_{name}", str(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _jwt(user='u@test.com', customer_id='CU1', customer='empresa', user_id='U1', minutes=60):
    payload = {
        'user': user, 'customerId': customer_id, 'customer': customer, 'userId': user_id,
        'exp': datetime.utcnow() + timedelta(minutes=minutes),
    }
    tok = jwt.encode(payload, os.environ['SECRET_KEY'], algorithm='HS256')
    return tok if isinstance(tok, str) else tok.decode()


@pytest.fixture(scope="module")
def mods():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')

        def mk(name, pk):
            ddb.create_table(
                TableName=name, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
                AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
                BillingMode='PAY_PER_REQUEST')

        for t, pk in [('campaign', 'campaignId'), ('process', 'processId'),
                      ('customer', 'customerId'), ('databaseFile', 'databaseFileId')]:
            mk(t, pk)

        res = boto3.resource('dynamodb', region_name='us-east-1')
        # Cliente CU1 (empresa) y CU2 (otra) para probar aislamiento multi-tenant.
        res.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'empresa', 'companyTin': '900'})
        res.Table('customer').put_item(Item={'customerId': 'CU2', 'company': 'otra', 'companyTin': '901'})
        # Campañas
        res.Table('campaign').put_item(Item={'campaignId': 'C1', 'customerId': 'CU1', 'campaignName': 'Promo', 'campaignState': 'Terminada', 'channel': 'EM', 'consecutive': '0001', 'template': 'empresa_0001_EM_Promo', 'date': '2026-07-01'})
        res.Table('campaign').put_item(Item={'campaignId': 'C9', 'customerId': 'CU2', 'campaignName': 'Ajena', 'campaignState': 'Pendiente', 'channel': 'EM', 'date': '2026-07-02'})
        # Proceso + estados de C1 (tabla única {customer}_sendStatus, PK processId + SK sendStatusId)
        res.Table('process').put_item(Item={'processId': 'P1', 'campaignId': 'C1', 'customerName': 'empresa', 'registersToSend': 3})
        ddb.create_table(
            TableName='empresa_sendStatus',
            KeySchema=[{'AttributeName': 'processId', 'KeyType': 'HASH'},
                       {'AttributeName': 'sendStatusId', 'KeyType': 'RANGE'}],
            AttributeDefinitions=[{'AttributeName': 'processId', 'AttributeType': 'S'},
                                  {'AttributeName': 'sendStatusId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        st = res.Table('empresa_sendStatus')
        rows = [('m1', 1), ('m1', 2), ('m1', 4), ('m2', 1), ('m2', 6), ('m3', 1)]
        for i, (mid, state) in enumerate(rows):
            st.put_item(Item={'processId': 'P1', 'sendStatusId': f's{i}', 'messageId': mid, 'state': state})
        # Bases de datos (databaseFile) de CU1
        res.Table('databaseFile').put_item(Item={'databaseFileId': 'D1', 'customerId': 'CU1', 'customer': 'empresa', 'fileName': 'base.csv', 's3Path': 'x/base.csv', 'totalRecords': 100, 'uploadDate': '2026-07-01T00:00:00Z'})
        res.Table('databaseFile').put_item(Item={'databaseFileId': 'D9', 'customerId': 'CU2', 'customer': 'otra', 'fileName': 'ajena.csv', 's3Path': 'y/a.csv', 'totalRecords': 5, 'uploadDate': '2026-07-01T00:00:00Z'})
        # Plantillas SES: 2 del cliente, 1 de otro
        ses = boto3.client('ses', region_name='us-east-1')
        for name in ['empresa_0001_EM_Promo', 'empresa_0002_EM_Boletin', 'otra_0001_EM_Ajena']:
            ses.create_template(Template={'TemplateName': name, 'SubjectPart': 'S', 'HtmlPart': '<p>x</p>', 'TextPart': 'x'})

        yield {name: _load(name, folder) for name, folder in LAMBDA_FILES.items()}


def _auth_event(body, customer_id='CU1', customer='empresa'):
    """Evento con el context del Authorizer (como lo inyecta API Gateway proxy)."""
    return {**body, 'requestContext': {'authorizer': {'customerId': customer_id, 'customer': customer}}}


# ───────────────────────── Authorizer (context multi-tenant) ─────────────────────────

def test_authorizer_devuelve_customerId_en_context(mods):
    resp = mods['authorizer'].lambda_handler({'authorizationToken': 'Bearer ' + _jwt()}, None)
    assert resp['policyDocument']['Statement'][0]['Effect'] == 'Allow'
    assert resp['context']['customerId'] == 'CU1'
    assert resp['context']['customer'] == 'empresa'


# ───────────────────────── Refresh token ─────────────────────────

def test_refresh_token_renueva(mods):
    resp = mods['refresh'].lambda_handler({'token': _jwt(minutes=30)}, None)
    assert resp['statusCode'] == 200
    new_tok = resp['data']['token']
    decoded = jwt.decode(new_tok, os.environ['SECRET_KEY'], algorithms=['HS256'])
    assert decoded['customerId'] == 'CU1'  # conserva los claims


def test_refresh_token_expirado_401(mods):
    resp = mods['refresh'].lambda_handler({'token': _jwt(minutes=-5)}, None)
    assert resp['statusCode'] == 401


def test_refresh_token_sin_token_401(mods):
    resp = mods['refresh'].lambda_handler({}, None)
    assert resp['statusCode'] == 401


# ───────────────────────── Campaign / List ─────────────────────────

def test_campaign_list_por_customer(mods):
    resp = mods['campaign_list'].lambda_handler(_auth_event({}), None)
    assert resp['statusCode'] == 200
    nombres = [c['campaignName'] for c in resp['data']['campaigns']]
    assert 'Promo' in nombres and 'Ajena' not in nombres  # aislamiento por cliente


def test_campaign_list_authorizer_manda_sobre_body(mods):
    # El body intenta espiar a CU2, pero el context del Authorizer dice CU1.
    resp = mods['campaign_list'].lambda_handler(_auth_event({'customerId': 'CU2'}), None)
    nombres = [c['campaignName'] for c in resp['data']['campaigns']]
    assert nombres == ['Promo']  # se ignora el customerId del body


# ───────────────────────── Template / List ─────────────────────────

def test_template_list_filtra_por_prefijo(mods):
    resp = mods['template_list'].lambda_handler({'customer': 'empresa'}, None)
    assert resp['statusCode'] == 200
    nombres = [t['name'] for t in resp['data']['templates']]
    assert set(nombres) == {'empresa_0001_EM_Promo', 'empresa_0002_EM_Boletin'}


def test_template_list_authorizer_manda(mods):
    resp = mods['template_list'].lambda_handler(_auth_event({'customer': 'otra'}), None)
    nombres = [t['name'] for t in resp['data']['templates']]
    assert all(n.startswith('empresa_') for n in nombres)  # usa el del token, no 'otra'


# ───────────────────────── Database / List ─────────────────────────

def test_database_list_por_customer(mods):
    resp = mods['database_list'].lambda_handler(_auth_event({}), None)
    archivos = [f['fileName'] for f in resp['data']['files']]
    assert archivos == ['base.csv']


# ───────────────────────── Statistics ─────────────────────────

def test_statistics_agrega_estados(mods):
    resp = mods['statistics'].lambda_handler(_auth_event({}), None)
    assert resp['statusCode'] == 200
    c1 = next(c for c in resp['data']['campaigns'] if c['id'] == 'C1')
    assert c1['enviados'] == 3       # m1, m2, m3
    assert c1['entregados'] == 1     # solo m1 (Abierto implica entregado)
    assert c1['abiertos'] == 1       # m1
    assert c1['rebotes'] == 1        # m2 (Bounce)
    assert c1['estado'] == 'enviada'


def test_statistics_aislamiento(mods):
    # Con el context de CU2 no debe ver la campaña de CU1.
    resp = mods['statistics'].lambda_handler(_auth_event({'customerId': 'CU1', 'customer': 'empresa'}, 'CU2', 'otra'), None)
    ids = [c['id'] for c in resp['data']['campaigns']]
    assert 'C1' not in ids
