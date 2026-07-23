"""
Regresión: el envío de SMS/WhatsApp debe usar el contenido VIGENTE de la plantilla, no una
copia congelada al crear la campaña.

Bug reportado: el cliente creó una campaña con la plantilla SMS = "Hola", luego editó la
plantilla a "Hola dos" y al enviar muestras/real seguía llegando "Hola" (se enviaba el
snapshot guardado en `campaign.template`, no la plantilla actualizada).

Fix: la campaña de SMS/WSP guarda una REFERENCIA (`campaign.messageTemplateId`) y Prepare-batch
resuelve el `body` (SMS) / `hsmName` (WSP) EN VIVO desde la tabla `messageTemplate` al enviar.
Si no hay referencia o no se resuelve (plantilla borrada / de otro tenant), cae al snapshot.

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

REPO_ROOT = Path(__file__).resolve().parents[2]
PB_PATH = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Email_Prepare-batch-template' / 'lambda_function.py'

CSV_SMS = (
    "Id;Celular;Nombre\n"
    "1;3011234567;Ana\n"
    "2;+573022345678;Luis\n"
)

TENANT = '900123'  # tenant_key('900123')


def _load_prepare_batch():
    if 'pandas' not in sys.modules:
        sys.modules['pandas'] = types.ModuleType('pandas')
    spec = importlib.util.spec_from_file_location('pb_live_mod', str(PB_PATH))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _mk_table(ddb, name, keys):
    ddb.create_table(
        TableName=name,
        KeySchema=[{'AttributeName': k, 'KeyType': t} for k, t in keys],
        AttributeDefinitions=[{'AttributeName': k, 'AttributeType': 'S'} for k, _ in keys],
        BillingMode='PAY_PER_REQUEST')


def _base_env(monkeypatch, campaign_extra, message_templates=None):
    """Monta el entorno moto con una campaña SMS + (opcional) plantillas de mensaje.

    `campaign_extra` completa/override los campos de la campaña C1 (p. ej. messageTemplateId).
    `message_templates` es una lista de items para la tabla messageTemplate.
    Devuelve (módulo, sms_url, part_url).
    """
    ddb = boto3.client('dynamodb', region_name='us-east-1')
    res = boto3.resource('dynamodb', region_name='us-east-1')

    _mk_table(ddb, 'campaign', [('campaignId', 'HASH')])
    _mk_table(ddb, 'process', [('processId', 'HASH')])
    _mk_table(ddb, 'customer', [('customerId', 'HASH')])
    _mk_table(ddb, 'messageTemplate', [('messageTemplateId', 'HASH')])
    _mk_table(ddb, f'{TENANT}_unsubscribe', [('email', 'HASH')])
    _mk_table(ddb, f'{TENANT}_blackList', [('email', 'HASH')])

    campaign = {
        'campaignId': 'C1', 'campaignName': 'PromoSMS', 'customerId': 'CU1',
        'consecutive': 1, 'channel': 'SMS', 'dataPath': 'bases/base.csv',
        'campaignState': 'Pendiente', 'originEmail': 'envios@empresa.com',
        # Snapshot "viejo" guardado al crear la campaña (lo que llegaba por error).
        'template': 'Hola', 'samplesSentCount': 0,
    }
    campaign.update(campaign_extra)
    res.Table('campaign').put_item(Item=campaign)
    res.Table('customer').put_item(Item={
        'customerId': 'CU1', 'company': 'empresa', 'companyTin': '900123', 'realSendEnabled': True})
    for mt in (message_templates or []):
        res.Table('messageTemplate').put_item(Item=mt)

    s3 = boto3.client('s3', region_name='us-east-1')
    s3.create_bucket(Bucket='mailconnect-900123')
    s3.put_object(Bucket='mailconnect-900123', Key='bases/base.csv', Body=CSV_SMS.encode('utf-8'))

    sqs = boto3.client('sqs', region_name='us-east-1')
    sms_url = sqs.create_queue(QueueName='Sms_Send-batch')['QueueUrl']
    part_url = sqs.create_queue(QueueName='Email_Prepare-batch-part')['QueueUrl']

    module = _load_prepare_batch()
    monkeypatch.setattr(module, 'URL_SQS_SMS', sms_url)
    monkeypatch.setattr(module, 'URL_SQS_PREPARE_PART', part_url)
    return module, sms_url, part_url


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


def _real_event():
    # El campo `template` del evento es irrelevante para SMS: el contenido sale de la campaña.
    # tenantRole owner en el context: el envío real exige owner/approver (gate RBAC).
    return {'resource': '/Email/Send-batch-template',
            'requestContext': {'authorizer': {'tenantRole': 'owner'}},
            'body': json.dumps({
                'customerName': 'empresa', 'campaignName': 'PromoSMS', 'userId': 'U1',
                'template': 'ignorado', 'templateVersion': 1})}


def _run_real_send_and_get_bodies(pb, sms_url, part_url):
    pb.lambda_handler(_real_event(), None)
    for j in _drain(part_url):
        pb.lambda_handler({'Records': [{'body': json.dumps(j)}]}, None)
    return _drain(sms_url)


def test_sms_usa_plantilla_editada_no_el_snapshot(monkeypatch):
    """La campaña referencia messageTemplateId=MT1; la plantilla se editó a 'Hola dos'.
    El envío debe usar 'Hola dos' (vigente), NO 'Hola' (snapshot de la campaña)."""
    with mock_aws():
        pb, sms_url, part_url = _base_env(
            monkeypatch,
            campaign_extra={'messageTemplateId': 'MT1'},
            message_templates=[{
                'messageTemplateId': 'MT1', 'customerId': 'CU1', 'channel': 'SMS',
                'name': 'Promo', 'body': 'Hola dos',
            }],
        )
        msgs = _run_real_send_and_get_bodies(pb, sms_url, part_url)
        assert msgs, 'no se encoló ningún SMS'
        bodies = {m.get('smsBody') for m in msgs}
        assert bodies == {'Hola dos'}, f'esperaba la plantilla vigente, llegó {bodies}'


def test_sms_sin_referencia_usa_snapshot(monkeypatch):
    """Campaña vieja SIN messageTemplateId: se conserva el comportamiento previo (snapshot)."""
    with mock_aws():
        pb, sms_url, part_url = _base_env(monkeypatch, campaign_extra={})
        msgs = _run_real_send_and_get_bodies(pb, sms_url, part_url)
        assert msgs
        assert {m.get('smsBody') for m in msgs} == {'Hola'}


def test_sms_referencia_de_otro_tenant_cae_al_snapshot(monkeypatch):
    """Aislamiento: si la plantilla referenciada es de OTRO cliente, se ignora (usa snapshot)."""
    with mock_aws():
        pb, sms_url, part_url = _base_env(
            monkeypatch,
            campaign_extra={'messageTemplateId': 'MT9'},
            message_templates=[{
                'messageTemplateId': 'MT9', 'customerId': 'OTRO', 'channel': 'SMS',
                'name': 'Ajeno', 'body': 'texto de otro cliente',
            }],
        )
        msgs = _run_real_send_and_get_bodies(pb, sms_url, part_url)
        assert msgs
        assert {m.get('smsBody') for m in msgs} == {'Hola'}


def test_sms_referencia_borrada_cae_al_snapshot(monkeypatch):
    """Si la plantilla referenciada ya no existe (borrada), cae al snapshot sin romper el envío."""
    with mock_aws():
        pb, sms_url, part_url = _base_env(
            monkeypatch, campaign_extra={'messageTemplateId': 'NO_EXISTE'})
        msgs = _run_real_send_and_get_bodies(pb, sms_url, part_url)
        assert msgs
        assert {m.get('smsBody') for m in msgs} == {'Hola'}


def test_resolve_live_message_content_helper(monkeypatch):
    """Unit del helper: SMS→body, WSP→hsmName, mismatch de tenant→None, sin id→None."""
    with mock_aws():
        pb, _, _ = _base_env(
            monkeypatch,
            campaign_extra={},
            message_templates=[
                {'messageTemplateId': 'S1', 'customerId': 'CU1', 'channel': 'SMS', 'body': 'texto sms'},
                {'messageTemplateId': 'W1', 'customerId': 'CU1', 'channel': 'WSP', 'hsmName': 'promo_hsm'},
            ],
        )
        assert pb.resolve_live_message_content('S1', 'CU1', 'SMS') == 'texto sms'
        assert pb.resolve_live_message_content('W1', 'CU1', 'WSP') == 'promo_hsm'
        assert pb.resolve_live_message_content('S1', 'OTRO', 'SMS') is None   # otro tenant
        assert pb.resolve_live_message_content('', 'CU1', 'SMS') is None      # sin id
        assert pb.resolve_live_message_content('S1', 'CU1', 'VOZ') is None    # canal sin plantilla
