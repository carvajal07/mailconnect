"""
Proveedor de envío por canal y por cliente (providerConfig).

El admin elige por cuál proveedor sale cada canal (EMAIL/SMS/WSP/VOZ), global (`*`) o
por cliente. Prepare-batch resuelve (cliente → global → aws) y el proveedor viaja en el
mensaje SQS; el worker despacha al adaptador. FAIL-OPEN a aws en el ruteo (una tabla
caída jamás detiene un envío) y FAIL-CLOSED en credenciales (falta la credencial del
proveedor elegido → el lote FALLA y SQS reintenta, sin quemar destinatarios).
"""
import importlib.util
import io
import json
import os
import sys
import types
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')
sys.modules.setdefault('pandas', types.ModuleType('pandas'))

import boto3  # noqa: E402
import pytest  # noqa: E402
from moto import mock_aws  # noqa: E402

from helpers_auth import make_token  # noqa: E402

REPO = Path(__file__).resolve().parents[2] / '04_Backend' / 'lambdas'


def _load(folder, name=None):
    spec = importlib.util.spec_from_file_location(
        name or ('m_' + folder.replace('-', '_')), str(REPO / folder / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _admin_event(body):
    return {'body': body, 'authToken': make_token(role='admin'),
            'requestContext': {'authorizer': {'role': 'admin', 'user': 'admin@mc'}}}


def _mk_provider_table():
    boto3.client('dynamodb').create_table(
        TableName='providerConfig',
        KeySchema=[{'AttributeName': 'customerId', 'KeyType': 'HASH'},
                   {'AttributeName': 'channel', 'KeyType': 'RANGE'}],
        AttributeDefinitions=[{'AttributeName': 'customerId', 'AttributeType': 'S'},
                              {'AttributeName': 'channel', 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


def _mk_audit_table():
    boto3.client('dynamodb').create_table(
        TableName='adminAudit',
        KeySchema=[{'AttributeName': 'auditId', 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': 'auditId', 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


# ── Admin: Set/List ─────────────────────────────────────────────────────────
def test_set_sin_admin_403():
    with mock_aws():
        m = _load('Api_V1_Provider_Set')
        r = m.lambda_handler({'body': {'channel': 'SMS', 'provider': 'twilio'}}, None)
        assert r['statusCode'] == 403


def test_set_y_list_global_y_por_cliente():
    with mock_aws():
        _mk_audit_table()
        mset = _load('Api_V1_Provider_Set')
        mlist = _load('Api_V1_Provider_List', 'prov_list_a')
        # Global (sin customerId) y override del cliente.
        r1 = mset.lambda_handler(_admin_event({'channel': 'SMS', 'provider': 'twilio'}), None)
        assert r1['statusCode'] == 200 and r1['data']['customerId'] == '*'
        r2 = mset.lambda_handler(_admin_event(
            {'customerId': 'c-panaderia', 'channel': 'SMS', 'provider': 'infobip'}), None)
        assert r2['statusCode'] == 200

        out = mlist.lambda_handler(_admin_event({}), None)
        assert out['statusCode'] == 200
        assert out['data']['global']['SMS'] == 'twilio'
        assert out['data']['overrides'][0]['provider'] == 'infobip'
        # La matriz viaja al front: es la única fuente de qué se puede elegir.
        assert 'twilio' in out['data']['capabilities']['SMS']


def test_set_rechaza_proveedor_sin_adaptador():
    """⚠️ Es la promesa del switch: no se puede guardar un proveedor que el worker no
    sabe usar — se guardaría la promesa y fallaría el canal entero del cliente."""
    with mock_aws():
        _mk_audit_table()
        mset = _load('Api_V1_Provider_Set')
        r = mset.lambda_handler(_admin_event({'channel': 'WSP', 'provider': 'twilio'}), None)
        assert r['statusCode'] == 400
        assert 'aws' in r['description']
        r2 = mset.lambda_handler(_admin_event({'channel': 'EMAIL', 'provider': 'twilio'}), None)
        assert r2['statusCode'] == 400


def test_remove_vuelve_a_heredar():
    with mock_aws():
        _mk_audit_table()
        mset = _load('Api_V1_Provider_Set')
        mlist = _load('Api_V1_Provider_List', 'prov_list_b')
        mset.lambda_handler(_admin_event({'customerId': 'c1', 'channel': 'VOZ', 'provider': 'twilio'}), None)
        mset.lambda_handler(_admin_event({'customerId': 'c1', 'channel': 'VOZ', 'remove': True}), None)
        out = mlist.lambda_handler(_admin_event({}), None)
        assert out['data']['overrides'] == []


def test_set_audita():
    with mock_aws():
        _mk_audit_table()
        mset = _load('Api_V1_Provider_Set')
        mset.lambda_handler(_admin_event({'channel': 'VOZ', 'provider': 'twilio'}), None)
        rows = boto3.resource('dynamodb').Table('adminAudit').scan()['Items']
        assert any(r['action'] == 'provider.set' for r in rows)


# ── Resolución en Prepare-batch ─────────────────────────────────────────────
@pytest.fixture()
def prep():
    with mock_aws():
        os.environ['PBKDF2_ITERATIONS'] = '1000'
        yield _load('Api_V1_Email_Prepare-batch-template')


def test_resolucion_cliente_gana_a_global(prep):
    _mk_provider_table()
    t = boto3.resource('dynamodb').Table('providerConfig')
    t.put_item(Item={'customerId': '*', 'channel': 'SMS', 'provider': 'twilio'})
    t.put_item(Item={'customerId': 'c-pan', 'channel': 'SMS', 'provider': 'infobip'})
    assert prep.resolve_provider('c-pan', 'SMS') == 'infobip'
    assert prep.resolve_provider('c-otro', 'SMS') == 'twilio'   # hereda el global


def test_resolucion_sin_filas_cae_a_aws(prep):
    _mk_provider_table()
    assert prep.resolve_provider('c-x', 'VOZ') == 'aws'


def test_resolucion_sin_tabla_fail_open_a_aws(prep):
    """⚠️ El ruteo es una preferencia: la tabla ausente (o un error leyéndola) jamás
    debe detener un envío. Se envía por aws, el camino que siempre existió."""
    assert prep.resolve_provider('c-x', 'SMS') == 'aws'


def test_subcanales_de_correo_comparten_la_clave_EMAIL(prep):
    _mk_provider_table()
    boto3.resource('dynamodb').Table('providerConfig').put_item(
        Item={'customerId': '*', 'channel': 'EMAIL', 'provider': 'socketlabs'})
    for canal in ('EM', 'EAU', 'EAP'):
        assert prep.resolve_provider('c-x', canal) == 'socketlabs'


def test_build_ctx_lleva_el_proveedor(prep):
    st = prep.ProcessState()
    st.provider = 'twilio'
    assert prep.build_ctx(st)['provider'] == 'twilio'


# ── Workers: despacho y credenciales ────────────────────────────────────────
def _sms_event(provider):
    body = {'customerName': 'ACME', 'nit': '900123456', 'processId': 'p1',
            'campaignId': 'c1', 'part': 0, 'headers': ['Id', 'Celular', 'Nombre'],
            'smsBody': 'Hola {{Nombre}}', 'provider': provider,
            'data': [['1', '+573001112233', 'Ana']]}
    return {'Records': [{'body': json.dumps(body)}]}


def test_sms_sin_credencial_twilio_falla_el_lote_no_los_destinatarios():
    """⚠️ La lección del originationIdentity de Voz: un error de CONFIGURACIÓN debe fallar
    el lote (SQS reintenta) — no marcar a cada destinatario como rechazado."""
    with mock_aws():
        m = _load('Api_V1_Sms_Send-batch')
        m.TWILIO_ACCOUNT_SID = ''
        with pytest.raises(RuntimeError, match='twilio'):
            m.lambda_handler(_sms_event('twilio'), None)


def test_sms_proveedor_desconocido_falla_el_lote():
    with mock_aws():
        m = _load('Api_V1_Sms_Send-batch')
        with pytest.raises(RuntimeError, match='desconocido'):
            m.lambda_handler(_sms_event('paloma-mensajera'), None)


def test_sms_twilio_llama_su_api_y_no_a_aws(monkeypatch):
    with mock_aws():
        m = _load('Api_V1_Sms_Send-batch')
        m.TWILIO_ACCOUNT_SID = 'ACxxx'
        m.TWILIO_AUTH_TOKEN = 'tok'
        m.TWILIO_FROM_SMS = '+15550001111'
        # La tabla de claims del tenant, para que el claim funcione de verdad.
        boto3.client('dynamodb').create_table(
            TableName='900123456_processDetail',
            KeySchema=[{'AttributeName': 'processDetailId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'processDetailId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        boto3.client('dynamodb').create_table(
            TableName='900123456_sendStatus',
            KeySchema=[{'AttributeName': 'processId', 'KeyType': 'HASH'},
                       {'AttributeName': 'sendStatusId', 'KeyType': 'RANGE'}],
            AttributeDefinitions=[{'AttributeName': 'processId', 'AttributeType': 'S'},
                                  {'AttributeName': 'sendStatusId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')

        capturado = {}

        def _fake_urlopen(req, timeout=0):
            capturado['url'] = req.full_url
            capturado['body'] = req.data.decode()
            capturado['auth'] = req.get_header('Authorization', '')
            return io.BytesIO(json.dumps({'sid': 'SM123'}).encode())

        monkeypatch.setattr(m.urllib.request, 'urlopen', _fake_urlopen)

        def _boom(**kw):
            raise AssertionError('con provider=twilio NO debe llamarse a AWS EUM')
        monkeypatch.setattr(m.sms, 'send_text_message', _boom)

        m.lambda_handler(_sms_event('twilio'), None)
        assert 'api.twilio.com' in capturado['url']
        assert 'ACxxx' in capturado['url']
        assert 'Basic ' in capturado['auth']
        # La variable {{Nombre}} se personalizó antes de salir.
        assert 'Hola+Ana' in capturado['body'] or 'Hola%20Ana' in capturado['body']
        # Y el estado quedó con el sid de Twilio como messageId.
        rows = boto3.resource('dynamodb').Table('900123456_sendStatus').scan()['Items']
        assert rows and rows[0]['messageId'] == 'SM123'


def test_sms_mensaje_viejo_sin_provider_va_por_aws(monkeypatch):
    """Mensajes en vuelo de antes del despliegue no traen el campo: aws, como siempre."""
    with mock_aws():
        m = _load('Api_V1_Sms_Send-batch')
        m.ORIGINATION_IDENTITY = 'MAILCONNECT'
        ev = _sms_event('aws')
        cuerpo = json.loads(ev['Records'][0]['body'])
        del cuerpo['provider']
        ev['Records'][0]['body'] = json.dumps(cuerpo)
        llamado = {}
        monkeypatch.setattr(m, '_claim_part', lambda *a, **k: True)
        monkeypatch.setattr(m, '_record_status', lambda *a, **k: None)
        monkeypatch.setattr(m, '_mark_part', lambda *a, **k: None)
        monkeypatch.setattr(m, 'increment_samples_count', lambda *a, **k: None,
                            raising=False)
        monkeypatch.setattr(m.sms, 'send_text_message',
                            lambda **kw: llamado.update(kw) or {'MessageId': 'aws-1'})
        m.lambda_handler(ev, None)
        assert llamado.get('OriginationIdentity') == 'MAILCONNECT'


def test_voz_twilio_arma_el_twiml_y_escapa_el_texto(monkeypatch):
    with mock_aws():
        m = _load('Api_V1_Voice_Send-batch')
        m.TWILIO_ACCOUNT_SID = 'ACyyy'
        m.TWILIO_AUTH_TOKEN = 'tok'
        m.TWILIO_FROM_VOICE = '+15550002222'
        capturado = {}

        def _fake_urlopen(req, timeout=0):
            capturado['body'] = req.data.decode()
            return io.BytesIO(json.dumps({'sid': 'CA9'}).encode())
        monkeypatch.setattr(m.urllib.request, 'urlopen', _fake_urlopen)
        sid = m._send_voice_twilio('+573001112233', 'Deuda < 100 & al día')
        assert sid == 'CA9'
        import urllib.parse as up
        twiml = up.parse_qs(capturado['body'])['Twiml'][0]
        assert '<Say' in twiml
        # El texto va escapado: sin esto, un '<' del mensaje rompería el XML.
        assert '&lt;' in twiml and '&amp;' in twiml


def test_voz_sin_credencial_twilio_falla_el_lote():
    with mock_aws():
        m = _load('Api_V1_Voice_Send-batch')
        m.TWILIO_ACCOUNT_SID = ''
        with pytest.raises(RuntimeError, match='twilio'):
            m._check_provider_config('twilio')


# ── EMAIL (EM) por SocketLabs ───────────────────────────────────────────────
def test_render_local_replica_a_ses():
    with mock_aws():
        m = _load('Api_V1_Email_Send-batch-template-EM')
        datos = {'nombre': 'Ana', 'unsubscribeUrl': 'https://u'}
        assert m._render_ses_template('Hola {{nombre}}', datos) == 'Hola Ana'
        # Campo ausente → vacío, igual que SES.
        assert m._render_ses_template('Hola {{otro}}!', datos) == 'Hola !'
        # La forma condicional del menú de variables con respaldo.
        assert m._render_ses_template(
            '{{#if nombre}}{{nombre}}{{else}}amigo{{/if}}', datos) == 'Ana'
        assert m._render_ses_template(
            '{{#if apodo}}{{apodo}}{{else}}amigo{{/if}}', datos) == 'amigo'


def test_em_socketlabs_renderiza_y_no_llama_a_ses(monkeypatch):
    with mock_aws():
        m = _load('Api_V1_Email_Send-batch-template-EM')
        m.SOCKETLABS_SERVER_ID = '123'
        m.SOCKETLABS_API_KEY = 'sk'
        # La plantilla "bajada de SES" (cacheada) con una variable.
        m._TEMPLATE_CACHE['tpl1'] = ('Asunto {{nombre}}', '<p>Hola {{nombre}}</p>', 'Hola {{nombre}}')
        capturado = {}

        def _fake_urlopen(req, timeout=0):
            capturado['payload'] = json.loads(req.data.decode())
            return io.BytesIO(json.dumps({'ErrorCode': 'Success'}).encode())
        monkeypatch.setattr(m.urllib.request, 'urlopen', _fake_urlopen)

        destinos = [{'Destination': {'ToAddresses': ['ana@x.co']},
                     'ReplacementTemplateData': json.dumps({'nombre': 'Ana'})}]
        resp = m._send_bulk_socketlabs(destinos, 'noti@mailconnect.com.co', 'tpl1')
        assert resp['Status'][0]['Status'] == 'Success'
        msj = capturado['payload']['Messages'][0]
        assert msj['Subject'] == 'Asunto Ana'
        assert 'Hola Ana' in msj['HtmlBody']
        assert msj['To'][0]['EmailAddress'] == 'ana@x.co'


def test_em_socketlabs_error_total_relanza_para_reintentar(monkeypatch):
    """Un rechazo del REQUEST completo (credenciales, caída) debe relanzar: el chunk
    libera su claim y SQS reanuda — mismo contrato que el camino SES."""
    with mock_aws():
        m = _load('Api_V1_Email_Send-batch-template-EM')
        m.SOCKETLABS_SERVER_ID = '123'
        m.SOCKETLABS_API_KEY = 'sk'
        m._TEMPLATE_CACHE['tplX'] = ('a', 'h', 't')
        monkeypatch.setattr(
            m.urllib.request, 'urlopen',
            lambda req, timeout=0: io.BytesIO(json.dumps(
                {'ErrorCode': 'InvalidAuthentication'}).encode()))
        with pytest.raises(RuntimeError, match='SocketLabs'):
            m._send_bulk_socketlabs(
                [{'Destination': {'ToAddresses': ['a@b.c']},
                  'ReplacementTemplateData': '{}'}], 'x@y.z', 'tplX')


def test_em_sin_credencial_socketlabs_falla_el_lote():
    with mock_aws():
        m = _load('Api_V1_Email_Send-batch-template-EM')
        m.SOCKETLABS_SERVER_ID = ''
        with pytest.raises(RuntimeError, match='socketlabs'):
            m._check_provider_config('socketlabs')
