"""
Pruebas de la IMPERSONACIÓN auditada "ver como cliente" (Bloque D):
- Api_V1_Admin_Impersonate: gate admin, emite un token de bajo privilegio (role=client,
  tenantRole=operator, readonly=true, impersonatedBy), crea sesión y audita.
- El Authorizer reenvía readonly/impersonatedBy en el context.
- Prepare-batch rechaza (403) una sesión readonly (ni muestras ni envío real).
"""
import os
import sys
import json
import types
import base64
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402
import helpers_auth  # noqa: E402  (fija SECRET_KEY antes de cargar las lambdas)
from helpers_auth import make_token  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DIR = REPO_ROOT / '04_Backend' / 'lambdas'


def _load(folder, name):
    if 'pandas' not in sys.modules:
        sys.modules['pandas'] = types.ModuleType('pandas')
    p = DIR / folder / 'lambda_function.py'
    spec = importlib.util.spec_from_file_location(name, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _pk(name, pk):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


def _admin(payload=None, user='ana@acme.co'):
    return {'body': None, 'authToken': make_token(user=user, userId='ADM1'),
            'requestContext': {'authorizer': {'role': 'admin', 'user': user, 'userId': 'ADM1'}},
            **(payload or {})}


def _claims(token):
    payload = token.split('.')[1]
    return json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))


@pytest.fixture
def imp():
    with mock_aws():
        _pk('customer', 'customerId')
        _pk('session', 'sessionId')
        _pk('adminAudit', 'auditId')
        boto3.resource('dynamodb', region_name='us-east-1').Table('customer').put_item(
            Item={'customerId': 'CU1', 'company': 'Acme', 'companyTin': '900'})
        yield _load('Api_V1_Admin_Impersonate', 'impersonate')


def test_requiere_admin(imp):
    resp = imp.lambda_handler({'customerId': 'CU1',
                               'requestContext': {'authorizer': {'role': 'client'}}}, None)
    assert resp['statusCode'] == 403


def test_falta_customer_id_400(imp):
    assert imp.lambda_handler(_admin(), None)['statusCode'] == 400


def test_cliente_inexistente_404(imp):
    assert imp.lambda_handler(_admin({'customerId': 'NOPE'}), None)['statusCode'] == 404


def test_emite_token_solo_lectura_y_audita(imp):
    resp = imp.lambda_handler(_admin({'customerId': 'CU1'}), None)
    assert resp['statusCode'] == 200
    d = resp['data']
    assert d['customer'] == 'Acme' and d['impersonatedBy'] == 'ana@acme.co'
    claims = _claims(d['token'])
    assert claims['customerId'] == 'CU1' and claims['nit'] == '900'
    assert claims['role'] == 'client'            # nunca abre /admin
    assert claims['tenantRole'] == 'operator'    # mínimo privilegio
    assert claims['readonly'] is True
    assert claims['impersonatedBy'] == 'ana@acme.co'
    assert claims['sid']                          # sesión revocable
    # Sesión creada y marcada como impersonación.
    sess = boto3.resource('dynamodb', region_name='us-east-1').Table('session').scan()['Items']
    assert len(sess) == 1 and sess[0]['impersonation'] is True
    # Auditado.
    audit = boto3.resource('dynamodb', region_name='us-east-1').Table('adminAudit').scan()['Items']
    assert any(a['action'] == 'support.impersonate' and 'Acme' in a['target'] for a in audit)


def test_authorizer_reenvia_readonly(imp):
    # El token de impersonación pasa por el Authorizer → context readonly/impersonatedBy.
    token = imp.lambda_handler(_admin({'customerId': 'CU1'}), None)['data']['token']
    authz = _load('Authorizer', 'authz_imp')
    resp = authz.lambda_handler({'authorizationToken': 'Bearer ' + token, 'methodArn': '*'}, None)
    ctx = resp['context']
    assert ctx['readonly'] == 'true'
    assert ctx['impersonatedBy'] == 'ana@acme.co'
    assert ctx['tenantRole'] == 'operator' and ctx['role'] == 'client'


def test_prepare_batch_rechaza_readonly():
    with mock_aws():
        pb = _load('Api_V1_Email_Prepare-batch-template', 'pb_readonly')
        event = {
            'resource': '/Email/Send-batch-template-samples',
            'body': json.dumps({'customerName': 'Acme', 'campaignName': 'Promo',
                                 'userId': 'U1', 'template': 't', 'templateVersion': '1'}),
            'requestContext': {'authorizer': {'customerId': 'CU1', 'readonly': 'true'}},
        }
        resp = pb.lambda_handler(event, None)
        assert resp['statusCode'] == 403
        body = json.loads(resp['body'])
        assert 'solo lectura' in body['description'].lower()
