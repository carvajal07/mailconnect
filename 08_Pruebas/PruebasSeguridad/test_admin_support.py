"""
Pruebas de la CAJA DE SOPORTE admin:
  - Api_V1_Admin_Recipient-lookup: línea de tiempo de envíos a un contacto + listas.
  - Api_V1_Admin_User-support: reenviar activación / forzar reseteo / cerrar sesiones.
  - Api_V1_Admin_Templates: listado global de plantillas SES.
  - Api_V1_Admin_Domains: vista global de dominios remitentes.
moto (DynamoDB/SES); gate admin con 2ª barrera (helpers_auth).
"""
import hashlib
import importlib.util
import os
import sys
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers_auth import make_token  # noqa: E402

LAMBDAS = Path(__file__).resolve().parents[2] / '04_Backend' / 'lambdas'


def _load(folder, name):
    spec = importlib.util.spec_from_file_location(name, str(LAMBDAS / folder / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _admin(body=None):
    return {**(body or {}), 'authToken': make_token(),
            'requestContext': {'authorizer': {'role': 'admin', 'user': 'admin@mc.co'}}}


def _mk_table(ddb, name, pk):
    ddb.create_table(TableName=name,
                     KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
                     AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
                     BillingMode='PAY_PER_REQUEST')


# ── Recipient-lookup ──────────────────────────────────────────────────────────

@pytest.fixture
def lookup():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        _mk_table(ddb, 'customer', 'customerId')
        _mk_table(ddb, 'process', 'processId')
        _mk_table(ddb, '900_blackList', 'email')
        ddb.create_table(TableName='900_sendStatus',
                         KeySchema=[{'AttributeName': 'processId', 'KeyType': 'HASH'},
                                    {'AttributeName': 'sendStatusId', 'KeyType': 'RANGE'}],
                         AttributeDefinitions=[{'AttributeName': 'processId', 'AttributeType': 'S'},
                                               {'AttributeName': 'sendStatusId', 'AttributeType': 'S'}],
                         BillingMode='PAY_PER_REQUEST')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'Beta', 'companyTin': '900'})
        res.Table('process').put_item(Item={'processId': 'p1', 'campaignName': 'Promo Julio'})
        res.Table('process').put_item(Item={'processId': 'p2', 'campaignName': 'Cartera'})
        st = res.Table('900_sendStatus')
        st.put_item(Item={'processId': 'p1', 'sendStatusId': 's1', 'email': 'ana@x.com',
                          'state': 1, 'date': '2026-07-20T10:00:00Z', 'type1': 'EM', 'messageId': 'm1'})
        st.put_item(Item={'processId': 'p2', 'sendStatusId': 's2', 'email': 'ana@x.com',
                          'state': 6, 'date': '2026-07-22T10:00:00Z', 'type1': 'EM',
                          'type2': 'Rebote duro', 'messageId': 'm2'})
        st.put_item(Item={'processId': 'p1', 'sendStatusId': 's3', 'email': 'otro@x.com',
                          'state': 2, 'date': '2026-07-21T10:00:00Z', 'type1': 'EM'})
        st.put_item(Item={'processId': 'p2', 'sendStatusId': 's4', 'phone': '+573001234567',
                          'state': 1, 'date': '2026-07-23T10:00:00Z', 'type1': 'SMS'})
        res.Table('900_blackList').put_item(Item={'email': 'ana@x.com', 'rejectionType': 'Bounce'})
        yield _load('Api_V1_Admin_Recipient-lookup', 'rlookup')


def test_lookup_timeline_por_correo(lookup):
    resp = lookup.lambda_handler(_admin({'customerId': 'CU1', 'contact': 'ana@x.com'}), None)
    assert resp['statusCode'] == 200
    data = resp['data']
    assert data['company'] == 'Beta'
    assert data['count'] == 2
    # Más reciente primero, con nombre de campaña y etiqueta del estado.
    assert data['timeline'][0]['campaignName'] == 'Cartera'
    assert data['timeline'][0]['stateLabel'] == 'Rebote'
    assert data['timeline'][1]['campaignName'] == 'Promo Julio'
    assert data['lists']['blacklisted'] is True
    assert data['lists']['unsubscribed'] is False  # tabla ausente = no listado


def test_lookup_celular_normalizado(lookup):
    # Se busca el celular LOCAL; el registro está en E.164 → normalize_phone lo encuentra.
    resp = lookup.lambda_handler(_admin({'customerId': 'CU1', 'contact': '3001234567'}), None)
    assert resp['statusCode'] == 200
    assert resp['data']['count'] == 1
    assert resp['data']['timeline'][0]['channel'] == 'SMS'


def test_lookup_cliente_inexistente_404(lookup):
    assert lookup.lambda_handler(_admin({'customerId': 'NOPE', 'contact': 'a@x.com'}), None)['statusCode'] == 404


def test_lookup_faltan_datos_400_y_gate(lookup):
    assert lookup.lambda_handler(_admin({'customerId': 'CU1'}), None)['statusCode'] == 400
    forged = {'customerId': 'CU1', 'contact': 'a@x.com',
              'requestContext': {'authorizer': {'role': 'admin'}}}
    assert lookup.lambda_handler(forged, None)['statusCode'] == 403


# ── User-support ─────────────────────────────────────────────────────────────

@pytest.fixture
def support():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        for name, pk in [('user', 'userId'), ('userActivation', 'userActivationId'),
                         ('oneTimePassword', 'oneTimePasswordId'), ('session', 'sessionId'),
                         ('adminAudit', 'auditId')]:
            _mk_table(ddb, name, pk)
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('user').put_item(Item={'userId': 'U1', 'email': 'ana@x.com', 'active': False})
        res.Table('user').put_item(Item={'userId': 'U2', 'email': 'luis@x.com', 'active': True})
        res.Table('session').put_item(Item={'sessionId': 'se1', 'userId': 'U2', 'active': True})
        res.Table('session').put_item(Item={'sessionId': 'se2', 'userId': 'U2', 'active': True})
        res.Table('session').put_item(Item={'sessionId': 'se3', 'userId': 'U2', 'active': False})
        boto3.client('ses', region_name='us-east-1').verify_email_identity(
            EmailAddress='comunicaciones@mailconnect.com.co')
        yield _load('Api_V1_Admin_User-support', 'usupport'), res


def test_resend_activation_inactivo(support):
    mod, res = support
    resp = mod.lambda_handler(_admin({'userId': 'U1', 'action': 'resend-activation'}), None)
    assert resp['statusCode'] == 200
    rows = res.Table('userActivation').scan()['Items']
    assert len(rows) == 1
    assert rows[0]['userId'] == 'U1' and rows[0]['used'] is False and rows[0]['activationKey']
    # Auditado.
    assert any(a['action'] == 'support.resendActivation' for a in res.Table('adminAudit').scan()['Items'])


def test_resend_activation_cuenta_activa_409(support):
    mod, _ = support
    assert mod.lambda_handler(_admin({'userId': 'U2', 'action': 'resend-activation'}), None)['statusCode'] == 409


def test_force_reset_crea_otp_hasheado(support):
    mod, res = support
    resp = mod.lambda_handler(_admin({'userId': 'U2', 'action': 'force-reset'}), None)
    assert resp['statusCode'] == 200
    rows = res.Table('oneTimePassword').scan()['Items']
    assert len(rows) == 1
    otp = rows[0]
    assert otp['userId'] == 'U2' and otp['active'] is True
    # Hash sha256 de 64 hex (nunca el código en claro).
    assert len(otp['otpHash']) == 64 and int(otp['otpHash'], 16) >= 0
    assert any(a['action'] == 'support.forceReset' for a in res.Table('adminAudit').scan()['Items'])


def test_revoke_sessions(support):
    mod, res = support
    resp = mod.lambda_handler(_admin({'userId': 'U2', 'action': 'revoke-sessions'}), None)
    assert resp['statusCode'] == 200
    assert resp['data']['revoked'] == 2
    rows = {s['sessionId']: s['active'] for s in res.Table('session').scan()['Items']}
    assert rows == {'se1': False, 'se2': False, 'se3': False}


def test_support_404_400_y_gate(support):
    mod, _ = support
    assert mod.lambda_handler(_admin({'userId': 'NOPE', 'action': 'force-reset'}), None)['statusCode'] == 404
    assert mod.lambda_handler(_admin({'userId': 'U1', 'action': 'hackear'}), None)['statusCode'] == 400
    forged = {'userId': 'U1', 'action': 'force-reset',
              'requestContext': {'authorizer': {'role': 'admin'}}}
    assert mod.lambda_handler(forged, None)['statusCode'] == 403


# ── Templates global + Domains global ────────────────────────────────────────

@pytest.fixture
def catalogo():
    with mock_aws():
        ses = boto3.client('ses', region_name='us-east-1')
        ses.create_template(Template={'TemplateName': 'beta_1_promo', 'SubjectPart': 's',
                                      'HtmlPart': '<p>x</p>', 'TextPart': 'x'})
        ses.create_template(Template={'TemplateName': 'alfa_2_news', 'SubjectPart': 's',
                                      'HtmlPart': '<p>y</p>', 'TextPart': 'y'})
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        _mk_table(ddb, 'senderDomain', 'domainId')
        _mk_table(ddb, 'customer', 'customerId')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'Beta'})
        res.Table('senderDomain').put_item(Item={
            'domainId': 'd1', 'customerId': 'CU1', 'kind': 'domain', 'domain': 'beta.com',
            'status': 'verified', 'createdAt': '2026-07-01'})
        res.Table('senderDomain').put_item(Item={
            'domainId': 'd2', 'customerId': 'CU1', 'kind': 'email', 'domain': 'ventas@beta.com',
            'status': 'pending', 'createdAt': '2026-07-10'})
        yield (_load('Api_V1_Admin_Templates', 'atempl'), _load('Api_V1_Admin_Domains', 'adom'))


def test_templates_global(catalogo):
    templ, _ = catalogo
    resp = templ.lambda_handler(_admin(), None)
    assert resp['statusCode'] == 200
    data = resp['data']
    assert data['count'] == 2
    # Orden por prefijo de cliente; el prefijo se deriva del nombre.
    assert [t['name'] for t in data['templates']] == ['alfa_2_news', 'beta_1_promo']
    assert data['templates'][0]['customerPrefix'] == 'alfa'


def test_templates_gate(catalogo):
    templ, _ = catalogo
    assert templ.lambda_handler({'requestContext': {'authorizer': {'role': 'admin'}}}, None)['statusCode'] == 403


def test_templates_get_contenido_de_otro_cliente(catalogo):
    # El admin puede VER el contenido de la plantilla de CUALQUIER cliente. Por la ruta de
    # cliente (/Template/Get-template) esto daba 403 ("no pertenece a tu cuenta"), porque
    # exige que el nombre empiece por el prefijo del tenant del token.
    templ, _ = catalogo
    resp = templ.lambda_handler(_admin({'action': 'get', 'name': 'beta_1_promo'}), None)
    assert resp['statusCode'] == 200
    tpl = resp['data']['template']
    assert tpl['name'] == 'beta_1_promo' and tpl['html'] == '<p>x</p>'


def test_templates_get_inexistente_404_y_sin_nombre_400(catalogo):
    templ, _ = catalogo
    assert templ.lambda_handler(_admin({'action': 'get', 'name': 'no_existe'}), None)['statusCode'] == 404
    assert templ.lambda_handler(_admin({'action': 'get'}), None)['statusCode'] == 400


def test_templates_delete(catalogo):
    templ, _ = catalogo
    assert templ.lambda_handler(_admin({'action': 'delete', 'name': 'alfa_2_news'}), None)['statusCode'] == 200
    # Ya no aparece en el listado.
    nombres = [t['name'] for t in templ.lambda_handler(_admin(), None)['data']['templates']]
    assert nombres == ['beta_1_promo']


def test_templates_get_requiere_admin(catalogo):
    templ, _ = catalogo
    resp = templ.lambda_handler(
        {'action': 'get', 'name': 'beta_1_promo',
         'requestContext': {'authorizer': {'role': 'client'}}}, None)
    assert resp['statusCode'] == 403


def test_domains_global_con_empresa(catalogo):
    _, dom = catalogo
    resp = dom.lambda_handler(_admin(), None)
    assert resp['statusCode'] == 200
    rows = resp['data']['domains']
    assert len(rows) == 2
    # Pendientes primero (lo accionable), y el join trae el nombre de la empresa.
    assert rows[0]['status'] == 'pending' and rows[0]['company'] == 'Beta'
    assert rows[1]['status'] == 'verified'


def test_domains_gate(catalogo):
    _, dom = catalogo
    assert dom.lambda_handler({}, None)['statusCode'] == 403
