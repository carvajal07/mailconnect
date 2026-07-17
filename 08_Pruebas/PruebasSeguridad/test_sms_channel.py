"""
Regresión del canal SMS/WhatsApp/Voz en Prepare-batch-template.

Bugs corregidos que cubre esta suite:
  1) Las MUESTRAS validaban el destinatario SIEMPRE como correo → un celular como
     "3502452219" daba 400 "emails con error". Ahora se valida por canal (celular E.164).
  2) El ENVÍO REAL (procesar_parte) validaba line[1] SIEMPRE como correo → en SMS/WSP/VOZ
     TODOS los contactos caían en 'email inválido' (estado 11) y NO se encolaba nada.
  3) Los celulares locales colombianos (10 dígitos) no se normalizaban a E.164, que es lo
     que exigen las lambdas de envío (AWS End User Messaging / WhatsApp).

Usa moto (S3 + SQS + DynamoDB); `pandas` se stubea (viene por layer en AWS).
"""
import os
import sys
import json
import types
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402
from boto3.dynamodb.conditions import Key  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
PB_PATH = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Email_Prepare-batch-template' / 'lambda_function.py'

# CSV de una base de CELULARES (col 2 = celular, no correo). Incluye E.164, local con
# espacios y uno inválido, para ejercitar la normalización y el descarte.
CSV_SMS = (
    "Id;Celular;Nombre\n"
    "1;3011234567;Ana\n"          # local colombiano → +573011234567
    "2;+573022345678;Luis\n"      # ya en E.164
    "3;350 245 2219;Eva\n"        # local con espacios → +573502452219
    "4;123;Malo\n"                # celular inválido → estado 11
)

TENANT = '900123'  # tenant_key('900123')


def _load_prepare_batch():
    if 'pandas' not in sys.modules:
        sys.modules['pandas'] = types.ModuleType('pandas')
    spec = importlib.util.spec_from_file_location('pb_sms_mod', str(PB_PATH))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _mk_table(ddb, name, keys):
    ddb.create_table(
        TableName=name,
        KeySchema=[{'AttributeName': k, 'KeyType': t} for k, t in keys],
        AttributeDefinitions=[{'AttributeName': k, 'AttributeType': 'S'} for k, _ in keys],
        BillingMode='PAY_PER_REQUEST')


# --------------------------------------------------------------------------------------
# Unit tests de los helpers de contacto por canal (no necesitan AWS, solo el módulo).
# --------------------------------------------------------------------------------------
@pytest.fixture(scope="module")
def pbmod():
    # Los helpers (normalize_phone/valid_contact/_contact_key) NO tocan AWS, así que se carga
    # el módulo sin mock_aws. (Anidar mock_aws con el fixture `env` comparte el backend de moto
    # y hace chocar la creación de tablas entre tests.)
    return _load_prepare_batch()


@pytest.mark.parametrize("raw,expected", [
    ('3502452219', '+573502452219'),       # local colombiano de 10 dígitos
    ('+573502452219', '+573502452219'),    # ya E.164
    ('573502452219', '+573502452219'),     # con indicativo sin '+'
    ('350 245 2219', '+573502452219'),     # espacios
    ('(350) 245-2219', '+573502452219'),   # separadores
    ('00573502452219', '+573502452219'),   # prefijo de salida 00
    ('+13025551234', '+13025551234'),      # E.164 de otro país
    ('123', ''),                           # muy corto
    ('abc', ''),                           # no numérico
    ('', ''),                              # vacío
])
def test_normalize_phone(pbmod, raw, expected):
    assert pbmod.normalize_phone(raw) == expected


def test_valid_contact_email_channel(pbmod):
    assert pbmod.valid_contact('EM', 'ana@test.com') == (True, 'ana@test.com')
    # Un celular en un canal de correo es inválido.
    ok, _ = pbmod.valid_contact('EM', '3502452219')
    assert ok is False


def test_valid_contact_phone_channel(pbmod):
    # El celular se acepta y se DEVUELVE normalizado a E.164.
    assert pbmod.valid_contact('SMS', '3502452219') == (True, '+573502452219')
    assert pbmod.valid_contact('WSP', '+573022345678') == (True, '+573022345678')
    assert pbmod.valid_contact('VOZ', '3011234567') == (True, '+573011234567')
    # Un correo en un canal de celular es inválido.
    ok, _ = pbmod.valid_contact('SMS', 'ana@test.com')
    assert ok is False


def test_contact_key_dedup_celular(pbmod):
    # '3502452219' y '+573502452219' son el MISMO contacto (dedup por E.164).
    k1 = pbmod._contact_key(['1', '3502452219', 'Ana'])
    k2 = pbmod._contact_key(['2', '+57 350 245 2219', 'Otro'])
    assert k1 == k2 == '+573502452219'


# --------------------------------------------------------------------------------------
# Integración: envío REAL y MUESTRAS de una campaña SMS.
# --------------------------------------------------------------------------------------
@pytest.fixture
def env(monkeypatch):
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        res = boto3.resource('dynamodb', region_name='us-east-1')

        _mk_table(ddb, 'campaign', [('campaignId', 'HASH')])
        _mk_table(ddb, 'process', [('processId', 'HASH')])
        _mk_table(ddb, 'customer', [('customerId', 'HASH')])
        _mk_table(ddb, f'{TENANT}_unsubscribe', [('email', 'HASH')])
        _mk_table(ddb, f'{TENANT}_blackList', [('email', 'HASH')])

        # Campaña SMS: el campo `template` guarda el TEXTO del mensaje (no una plantilla SES).
        res.Table('campaign').put_item(Item={
            'campaignId': 'C1', 'campaignName': 'PromoSMS', 'customerId': 'CU1',
            'consecutive': 1, 'channel': 'SMS', 'dataPath': 'bases/base.csv',
            'campaignState': 'Pendiente', 'originEmail': 'envios@empresa.com',
            'template': 'Hola {{Nombre}}, promo!', 'samplesSentCount': 0,
        })
        res.Table('customer').put_item(Item={
            'customerId': 'CU1', 'company': 'empresa', 'companyTin': '900123', 'realSendEnabled': True})

        s3 = boto3.client('s3', region_name='us-east-1')
        s3.create_bucket(Bucket='mailconnect-900123')
        s3.put_object(Bucket='mailconnect-900123', Key='bases/base.csv', Body=CSV_SMS.encode('utf-8'))

        sqs = boto3.client('sqs', region_name='us-east-1')
        sms_url = sqs.create_queue(QueueName='Sms_Send-batch')['QueueUrl']
        part_url = sqs.create_queue(QueueName='Email_Prepare-batch-part')['QueueUrl']

        module = _load_prepare_batch()
        monkeypatch.setattr(module, 'URL_SQS_SMS', sms_url)
        monkeypatch.setattr(module, 'URL_SQS_PREPARE_PART', part_url)
        monkeypatch.setattr(module, 'PART_SIZE', 2)
        yield module, sms_url, part_url


def _drain(url):
    sqs = boto3.client('sqs', region_name='us-east-1')
    bodies = []
    while True:
        msgs = sqs.receive_message(QueueUrl=url, MaxNumberOfMessages=10).get('Messages', [])
        if not msgs:
            break
        for m in msgs:
            bodies.append(json.loads(m['Body']))
            sqs.delete_message(QueueUrl=url, ReceiptHandle=m['ReceiptHandle'])
    return bodies


def _campaign():
    return boto3.resource('dynamodb', region_name='us-east-1').Table('campaign').get_item(
        Key={'campaignId': 'C1'})['Item']


def _real_event():
    return {'resource': '/Email/Send-batch-template', 'body': json.dumps({
        'customerName': 'empresa', 'campaignName': 'PromoSMS', 'userId': 'U1',
        'template': 'Hola {{Nombre}}, promo!', 'templateVersion': 1})}


def test_envio_real_sms_encola_celulares_en_e164(env):
    """El envío real de SMS encola los celulares VÁLIDOS (normalizados a E.164) y solo el
    inválido queda como estado 11. Antes: TODOS caían en 'email inválido' y no se encolaba nada."""
    pb, sms_url, part_url = env
    pb.lambda_handler(_real_event(), None)
    process_id = _campaign()['sendProcessId']

    # Corre cada parte por el worker (evento SQS).
    for j in _drain(part_url):
        assert j['channel'] == 'SMS'                 # el canal viaja en el job
        assert j['channelQueue'] == sms_url
        pb.lambda_handler({'Records': [{'body': json.dumps(j)}]}, None)

    # La cola de SMS recibió los 3 válidos, TODOS en E.164 (el local se normalizó).
    msgs = _drain(sms_url)
    celulares = sorted(row[1] for m in msgs for row in m['data'])
    assert celulares == ['+573011234567', '+573022345678', '+573502452219']
    assert all(m.get('channel') == 'SMS' and m.get('smsBody') for m in msgs)

    # El inválido (123) quedó como estado 11.
    status_tbl = boto3.resource('dynamodb', region_name='us-east-1').Table(f'{TENANT}_sendStatus')
    rows = status_tbl.query(KeyConditionExpression=Key('processId').eq(process_id))['Items']
    assert [int(r['state']) for r in rows] == [11]

    # Conteos del proceso: 3 a enviar, 1 inválido.
    proc = boto3.resource('dynamodb', region_name='us-east-1').Table('process').get_item(
        Key={'processId': process_id})['Item']
    assert int(proc['registersToSend']) == 3
    assert int(proc['quantityDeletions']) == 1


def test_muestras_sms_acepta_celulares(env):
    """Las muestras de SMS aceptan celulares (antes: 400 'emails con error') y encolan el
    destinatario de prueba normalizado a E.164."""
    pb, sms_url, part_url = env
    monkeypatch_noop = lambda *a, **k: None
    pb.record_sample_batch = monkeypatch_noop
    pb._audit_send = monkeypatch_noop

    event = {'resource': '/Email/Send-batch-template-samples', 'body': json.dumps({
        'customerName': 'empresa', 'campaignName': 'PromoSMS', 'userId': 'U1',
        'template': 'Hola {{Nombre}}, promo!', 'templateVersion': 1,
        'quantitySamples': 2, 'selectiveSamples': False,
        'recipients': ['3011234567'],          # celular local de prueba
    })}
    resp = pb.lambda_handler(event, None)
    body = json.loads(resp['body'])
    assert body['status_code'] == 200 and body['status'] is True

    # La cola de SMS recibió las 2 muestras con el celular de prueba en E.164.
    msgs = _drain(sms_url)
    rows = [row for m in msgs for row in m['data']]
    assert len(rows) == 2
    assert all(r[1] == '+573011234567' for r in rows)
    assert all(m.get('samples') is True and m.get('channel') == 'SMS' for m in msgs)


def test_muestras_sms_rechaza_celular_invalido(env):
    """Un destinatario de muestra con celular inválido devuelve 400 con mensaje de 'celulares'."""
    pb, sms_url, part_url = env
    pb.record_sample_batch = lambda *a, **k: None
    pb._audit_send = lambda *a, **k: None

    event = {'resource': '/Email/Send-batch-template-samples', 'body': json.dumps({
        'customerName': 'empresa', 'campaignName': 'PromoSMS', 'userId': 'U1',
        'template': 'x', 'templateVersion': 1,
        'quantitySamples': 1, 'selectiveSamples': False,
        'recipients': ['123'],                 # inválido
    })}
    resp = pb.lambda_handler(event, None)
    body = json.loads(resp['body'])
    assert body['status_code'] == 400
    assert 'celulares' in body['description']
    assert _drain(sms_url) == []               # no se encoló nada
