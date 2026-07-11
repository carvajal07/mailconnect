"""
Fase 3b — Test de INTEGRACIÓN del handler de Prepare-batch-template con moto
(S3 + SQS + DynamoDB), como red de seguridad ANTES de partir el handler en
`preparar_muestras()` / `preparar_real()`. Cubre el flujo completo del envío real
(que hasta ahora solo se probaba por helpers puros) — punto #11 del refactor.

Escenario "camino feliz" del envío real:
  - CSV con 3 válidos (ana/luis/eva), 1 con estructura inválida y 1 en lista negra.
  - Se espera: 1 mensaje encolado (3 destinatarios < 250 → 1 parte), la campaña
    queda 'Enviando' con su sendProcessId, se registra el proceso y quedan filas
    de estado para el inválido y el de lista negra.

`pandas` se stubea (viene por layer en AWS y el handler no lo usa en esta ruta).
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

CSV_CONTENT = (
    "Id;Correo;Nombre\n"
    "1;ana@test.com;Ana\n"
    "2;luis@test.com;Luis\n"
    "3;eva@test.com;Eva\n"
    "4;malformado;Malo\n"          # estructura de email inválida
    "5;negro@test.com;Negro\n"     # válido pero en lista negra
)


def _load_prepare_batch():
    if 'pandas' not in sys.modules:
        sys.modules['pandas'] = types.ModuleType('pandas')
    spec = importlib.util.spec_from_file_location('pb_integ_mod', str(PB_PATH))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _mk_table(ddb, name, keys):
    ddb.create_table(
        TableName=name,
        KeySchema=[{'AttributeName': k, 'KeyType': t} for k, t in keys],
        AttributeDefinitions=[{'AttributeName': k, 'AttributeType': 'S'} for k, _ in keys],
        BillingMode='PAY_PER_REQUEST')


@pytest.fixture
def env(monkeypatch):
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        res = boto3.resource('dynamodb', region_name='us-east-1')

        # Tablas base del sistema.
        _mk_table(ddb, 'campaign', [('campaignId', 'HASH')])
        _mk_table(ddb, 'process', [('processId', 'HASH')])
        _mk_table(ddb, 'customer', [('customerId', 'HASH')])
        # Tablas del cliente que el handler ESPERA que ya existan (para que corra el
        # filtrado de lista negra / desuscritos). PK 'email'.
        _mk_table(ddb, 'empresa_unsubscribe', [('email', 'HASH')])
        _mk_table(ddb, 'empresa_blackList', [('email', 'HASH')])

        res.Table('campaign').put_item(Item={
            'campaignId': 'C1', 'campaignName': 'Promo', 'customerId': 'CU1',
            'consecutive': 1, 'channel': 'EM', 'dataPath': 'bases/base.csv',
            'campaignState': 'Pendiente', 'originEmail': 'envios@empresa.com',
            'template': 'T', 'samplesSentCount': 0,
        })
        res.Table('customer').put_item(Item={
            'customerId': 'CU1', 'company': 'empresa', 'realSendEnabled': True})
        res.Table('empresa_blackList').put_item(Item={'email': 'negro@test.com'})

        # S3: bucket {customer}.database con el CSV.
        s3 = boto3.client('s3', region_name='us-east-1')
        s3.create_bucket(Bucket='empresa.database')
        s3.put_object(Bucket='empresa.database', Key='bases/base.csv',
                      Body=CSV_CONTENT.encode('utf-8'))

        # SQS: cola real (moto) apuntada por URL_SQS_EM.
        sqs = boto3.client('sqs', region_name='us-east-1')
        queue_url = sqs.create_queue(QueueName='Email_Send-batch-template-EM')['QueueUrl']

        module = _load_prepare_batch()
        monkeypatch.setattr(module, 'URL_SQS_EM', queue_url)
        yield module, queue_url


def _event(resource='/Email/Send-batch-template'):
    return {
        'resource': resource,
        'body': json.dumps({
            'customerName': 'empresa', 'campaignName': 'Promo', 'userId': 'U1',
            'template': 'T', 'templateVersion': 1,
        }),
    }


def _campaign():
    return boto3.resource('dynamodb', region_name='us-east-1').Table('campaign').get_item(
        Key={'campaignId': 'C1'})['Item']


def test_envio_real_camino_feliz(env):
    pb, queue_url = env
    resp = pb.lambda_handler(_event(), None)
    body = json.loads(resp['body'])
    assert body['status'] is True
    assert body['status_code'] == 200

    # 1) La campaña quedó 'Enviando' con su sendProcessId (idempotencia).
    camp = _campaign()
    assert camp['campaignState'] == 'Enviando'
    process_id = camp['sendProcessId']
    assert process_id

    # 2) Se encoló exactamente 1 mensaje (3 válidos < 250 → 1 parte) con los 3 correos.
    sqs = boto3.client('sqs', region_name='us-east-1')
    msgs = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=10).get('Messages', [])
    assert len(msgs) == 1
    payload = json.loads(msgs[0]['Body'])
    correos = [row[1] for row in payload['data']]
    assert correos == ['ana@test.com', 'luis@test.com', 'eva@test.com']
    assert payload['processId'] == process_id
    assert payload['part'] == 1

    # 3) El proceso quedó registrado con las cantidades correctas.
    proc = boto3.resource('dynamodb', region_name='us-east-1').Table('process').get_item(
        Key={'processId': process_id})['Item']
    assert int(proc['registersOnSpool']) == 5
    assert int(proc['registersToSend']) == 3
    assert int(proc['quantityBlacklist']) == 1
    assert int(proc['quantityDeletions']) == 1
    assert int(proc['quantityUnsubscribe']) == 0

    # 4) Quedaron filas de estado (tabla única) para el inválido (11) y el de lista negra (13).
    status_tbl = boto3.resource('dynamodb', region_name='us-east-1').Table('empresa_sendStatus')
    rows = status_tbl.query(KeyConditionExpression=Key('processId').eq(process_id))['Items']
    estados = sorted(int(r['state']) for r in rows)
    assert estados == [11, 13]


def test_envio_real_duplicado_no_reencola(env):
    # Segundo envío de la MISMA campaña: ya quedó 'Enviando', así que el gate de estado
    # la rechaza (404) y NO se encola nada nuevo (no hay envíos duplicados). La ventana de
    # carrera fina (dos invocaciones que leen 'Pendiente' a la vez → AlreadySending/200) la
    # cubren las pruebas unitarias de try_start_real_send.
    pb, queue_url = env
    pb.lambda_handler(_event(), None)
    sqs = boto3.client('sqs', region_name='us-east-1')
    # Drena el primer mensaje.
    first = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=10).get('Messages', [])
    assert len(first) == 1
    for m in first:
        sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=m['ReceiptHandle'])

    resp = pb.lambda_handler(_event(), None)
    body = json.loads(resp['body'])
    assert body['status'] is False
    assert body['status_code'] == 404
    # No se encoló nada nuevo.
    again = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=10).get('Messages', [])
    assert again == []


def test_envio_real_deshabilitado_da_403(env):
    pb, queue_url = env
    boto3.resource('dynamodb', region_name='us-east-1').Table('customer').update_item(
        Key={'customerId': 'CU1'},
        UpdateExpression='SET realSendEnabled = :f',
        ExpressionAttributeValues={':f': False})
    resp = pb.lambda_handler(_event(), None)
    body = json.loads(resp['body'])
    assert body['status'] is False
    assert body['status_code'] == 403
    # La campaña NO se marcó Error ni Enviando (sigue Pendiente).
    assert _campaign()['campaignState'] == 'Pendiente'
