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


# Las tablas de estados por cliente se nombran por NIT saneado (tenant_key('900')='900').
TENANT = '900'


def _jwt(user='u@test.com', customer_id='CU1', customer='empresa', user_id='U1', nit='900',
         minutes=60, sid='S1', tenant_role=None):
    # `sid` = sesión ACTIVA en la tabla `session` (el Authorizer/Refresh la validan:
    # revocación server-side). El fixture crea la sesión S1 activa por defecto.
    payload = {
        'user': user, 'customerId': customer_id, 'customer': customer, 'nit': nit, 'userId': user_id,
        'exp': datetime.utcnow() + timedelta(minutes=minutes),
    }
    if sid is not None:
        payload['sid'] = sid
    if tenant_role is not None:
        payload['tenantRole'] = tenant_role
    tok = jwt.encode(payload, os.environ['SECRET_KEY'], algorithm='HS256')
    return tok if isinstance(tok, str) else tok.decode()


@pytest.fixture(scope="module")
def mods():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')

        def mk(name, pk, gsi_attr=None, gsi_name='customerId-index'):
            attrs = [{'AttributeName': pk, 'AttributeType': 'S'}]
            kw = {}
            if gsi_attr:  # GSI que ahora exigen las list-lambdas (Query por defecto)
                attrs.append({'AttributeName': gsi_attr, 'AttributeType': 'S'})
                kw['GlobalSecondaryIndexes'] = [{
                    'IndexName': gsi_name,
                    'KeySchema': [{'AttributeName': gsi_attr, 'KeyType': 'HASH'}],
                    'Projection': {'ProjectionType': 'ALL'}}]
            ddb.create_table(
                TableName=name, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
                AttributeDefinitions=attrs, BillingMode='PAY_PER_REQUEST', **kw)

        mk('campaign', 'campaignId', gsi_attr='customerId')
        mk('process', 'processId')
        mk('customer', 'customerId')
        mk('databaseFile', 'databaseFileId', gsi_attr='customerId')
        mk('session', 'sessionId')  # revocación: Authorizer/Refresh validan el claim sid
        mk('user', 'userId')        # Refresh revalida rol/sub-rol contra la base

        res = boto3.resource('dynamodb', region_name='us-east-1')
        # Sesión activa S1 (los tokens de _jwt la referencian por defecto).
        res.Table('session').put_item(Item={'sessionId': 'S1', 'userId': 'U1', 'active': True})
        res.Table('user').put_item(Item={'userId': 'U1', 'active': True, 'role': 'client', 'tenantRole': 'operator'})
        # Cliente CU1 (empresa) y CU2 (otra) para probar aislamiento multi-tenant.
        res.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'empresa', 'companyTin': '900'})
        res.Table('customer').put_item(Item={'customerId': 'CU2', 'company': 'otra', 'companyTin': '901'})
        # Campañas
        res.Table('campaign').put_item(Item={'campaignId': 'C1', 'customerId': 'CU1', 'campaignName': 'Promo', 'campaignState': 'Terminada', 'channel': 'EM', 'consecutive': '0001', 'template': 'empresa_0001_EM_Promo', 'date': '2026-07-01'})
        res.Table('campaign').put_item(Item={'campaignId': 'C9', 'customerId': 'CU2', 'campaignName': 'Ajena', 'campaignState': 'Pendiente', 'channel': 'EM', 'date': '2026-07-02'})
        # Proceso + estados de C1 (tabla única {tenant}_sendStatus, PK processId + SK sendStatusId;
        # tenant=tenant_key(companyTin)='900'). El filtro de `process` sigue por customerName.
        res.Table('process').put_item(Item={'processId': 'P1', 'campaignId': 'C1', 'customerName': 'empresa', 'registersToSend': 3})
        ddb.create_table(
            TableName=f'{TENANT}_sendStatus',
            KeySchema=[{'AttributeName': 'processId', 'KeyType': 'HASH'},
                       {'AttributeName': 'sendStatusId', 'KeyType': 'RANGE'}],
            AttributeDefinitions=[{'AttributeName': 'processId', 'AttributeType': 'S'},
                                  {'AttributeName': 'sendStatusId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        st = res.Table(f'{TENANT}_sendStatus')
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


def _auth_event(body, customer_id='CU1', customer='empresa', nit='900'):
    """Evento con el context del Authorizer (como lo inyecta API Gateway proxy). El `nit`
    (companyTin) es la llave de las tablas por cliente ({tenant_key(nit)}_sendStatus)."""
    return {**body, 'requestContext': {'authorizer': {'customerId': customer_id, 'customer': customer, 'nit': nit}}}


# ───────────────────────── Authorizer (context multi-tenant) ─────────────────────────

def test_authorizer_devuelve_customerId_en_context(mods):
    resp = mods['authorizer'].lambda_handler({'authorizationToken': 'Bearer ' + _jwt()}, None)
    assert resp['policyDocument']['Statement'][0]['Effect'] == 'Allow'
    assert resp['context']['customerId'] == 'CU1'
    assert resp['context']['customer'] == 'empresa'
    # El NIT (llave de recursos por cliente) también se reenvía en el context.
    assert resp['context']['nit'] == '900'


# ───────────────────────── Refresh token ─────────────────────────

def test_refresh_token_renueva(mods):
    resp = mods['refresh'].lambda_handler({'token': _jwt(minutes=30)}, None)
    assert resp['statusCode'] == 200
    new_tok = resp['data']['token']
    decoded = jwt.decode(new_tok, os.environ['SECRET_KEY'], algorithms=['HS256'])
    assert decoded['customerId'] == 'CU1'  # conserva los claims
    assert decoded['sid'] == 'S1'          # conserva la sesión (revocable)


def test_refresh_token_preserva_tenant_role(mods):
    # SEGURIDAD: el refresco debe conservar el sub-rol. Si lo omitiera, el Authorizer
    # aplicaría su default 'owner' y un operator quedaría ESCALADO a owner al renovar.
    resp = mods['refresh'].lambda_handler({'token': _jwt(minutes=30, tenant_role='operator')}, None)
    assert resp['statusCode'] == 200
    decoded = jwt.decode(resp['data']['token'], os.environ['SECRET_KEY'], algorithms=['HS256'])
    assert decoded['tenantRole'] == 'operator'


def test_refresh_token_sesion_revocada_401(mods):
    # Sesión cerrada (logout) → el token no se renueva.
    boto3.resource('dynamodb', region_name='us-east-1').Table('session').put_item(
        Item={'sessionId': 'S-rev', 'userId': 'U1', 'active': False})
    resp = mods['refresh'].lambda_handler({'token': _jwt(minutes=30, sid='S-rev')}, None)
    assert resp['statusCode'] == 401


def test_refresh_token_sin_sid_401(mods):
    # Token de formato viejo (sin sid): no es revocable → no se renueva.
    resp = mods['refresh'].lambda_handler({'token': _jwt(minutes=30, sid=None)}, None)
    assert resp['statusCode'] == 401


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
    resp = mods['statistics'].lambda_handler(_auth_event({'customerId': 'CU1', 'customer': 'empresa'}, 'CU2', 'otra', '901'), None)
    ids = [c['id'] for c in resp['data']['campaigns']]
    assert 'C1' not in ids


def test_statistics_rollup_no_consume_fallback(mods, monkeypatch):
    # "Adiós datos parciales": el tope BAJO (MAX_FALLBACK_QUERIES) aplica SOLO a los
    # procesos SIN rollup. Sin rollup y sin presupuesto → parcial; con la fila de
    # resumen pre-agregado el mismo proceso se agrega aunque el presupuesto sea cero.
    stats = mods['statistics']
    monkeypatch.setattr(stats, 'MAX_FALLBACK_QUERIES', 0)

    resp = stats.lambda_handler(_auth_event({}), None)
    c1 = next(c for c in resp['data']['campaigns'] if c['id'] == 'C1')
    assert c1['enviados'] == 0 and resp['data']['truncated'] is True

    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=f'{TENANT}_sendSummary',
        KeySchema=[{'AttributeName': 'processId', 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': 'processId', 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')
    boto3.resource('dynamodb', region_name='us-east-1').Table(f'{TENANT}_sendSummary').put_item(
        Item={'processId': 'P1', 'enviados': 3, 'entregados': 1, 'abiertos': 1,
              'clics': 0, 'rebotes': 1, 'quejas': 0})
    resp = stats.lambda_handler(_auth_event({}), None)
    c1 = next(c for c in resp['data']['campaigns'] if c['id'] == 'C1')
    assert c1['enviados'] == 3 and resp['data']['truncated'] is False
