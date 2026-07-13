"""
Fase 4 — Test de INTEGRACIÓN del fan-out de Prepare-batch-template con moto
(S3 + SQS + DynamoDB). Cubre el flujo real completo troceado en partes:

  1) SPLITTER (evento API): trocea el CSV en part-files en S3 y encola un trabajo por
     parte en la cola de partes; marca la campaña 'Enviando' e inicializa el proceso.
  2) WORKER (evento SQS): procesa cada parte → valida estructura, filtra lista negra,
     encola al canal, registra estados y ACUMULA los conteos en el proceso.

Con `PART_SIZE=2` el CSV de 5 filas se parte en 3 → se ejercita la numeración de
partes y la acumulación de conteos entre workers. `pandas` se stubea (viene por layer).
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

        _mk_table(ddb, 'campaign', [('campaignId', 'HASH')])
        _mk_table(ddb, 'process', [('processId', 'HASH')])
        _mk_table(ddb, 'customer', [('customerId', 'HASH')])
        _mk_table(ddb, 'empresa_unsubscribe', [('email', 'HASH')])
        _mk_table(ddb, 'empresa_blackList', [('email', 'HASH')])

        res.Table('campaign').put_item(Item={
            'campaignId': 'C1', 'campaignName': 'Promo', 'customerId': 'CU1',
            'consecutive': 1, 'channel': 'EM', 'dataPath': 'bases/base.csv',
            'campaignState': 'Pendiente', 'originEmail': 'envios@empresa.com',
            'template': 'T', 'samplesSentCount': 0,
        })
        res.Table('customer').put_item(Item={
            'customerId': 'CU1', 'company': 'empresa', 'companyTin': '900123', 'realSendEnabled': True})
        res.Table('empresa_blackList').put_item(Item={'email': 'negro@test.com'})

        # Bucket del cliente por NIT (nuevo esquema). La base vive aquí; el download y los
        # part-files deben usar mailconnect-900123-database (no el viejo por nombre).
        s3 = boto3.client('s3', region_name='us-east-1')
        s3.create_bucket(Bucket='mailconnect-900123-database')
        s3.put_object(Bucket='mailconnect-900123-database', Key='bases/base.csv',
                      Body=CSV_CONTENT.encode('utf-8'))

        sqs = boto3.client('sqs', region_name='us-east-1')
        channel_url = sqs.create_queue(QueueName='Email_Send-batch-template-EM')['QueueUrl']
        part_url = sqs.create_queue(QueueName='Email_Prepare-batch-part')['QueueUrl']

        module = _load_prepare_batch()
        monkeypatch.setattr(module, 'URL_SQS_EM', channel_url)
        monkeypatch.setattr(module, 'URL_SQS_PREPARE_PART', part_url)
        monkeypatch.setattr(module, 'PART_SIZE', 2)  # fuerza 3 partes (5 filas / 2)
        yield module, channel_url, part_url


def _api_event(resource='/Email/Send-batch-template'):
    return {
        'resource': resource,
        'body': json.dumps({
            'customerName': 'empresa', 'campaignName': 'Promo', 'userId': 'U1',
            'template': 'T', 'templateVersion': 1,
        }),
    }


def _drain(sqs, url):
    """Vacía y devuelve TODOS los cuerpos (JSON) de una cola moto."""
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


def _process(process_id):
    return boto3.resource('dynamodb', region_name='us-east-1').Table('process').get_item(
        Key={'processId': process_id})['Item']


def test_split_trocea_y_encola_trabajos_de_parte(env):
    pb, channel_url, part_url = env
    resp = pb.lambda_handler(_api_event(), None)
    assert json.loads(resp['body'])['status_code'] == 200

    # La campaña quedó 'Enviando' con su sendProcessId.
    camp = _campaign()
    assert camp['campaignState'] == 'Enviando'
    process_id = camp['sendProcessId']

    # El splitter NO encola al canal directamente (eso lo hace cada worker).
    assert _drain(boto3.client('sqs', region_name='us-east-1'), channel_url) == []

    # Encoló 3 trabajos de parte (5 filas / PART_SIZE=2 → partes [2]+[2]+[1]).
    jobs = _drain(boto3.client('sqs', region_name='us-east-1'), part_url)
    assert len(jobs) == 3
    assert sorted(j['part'] for j in jobs) == [1, 2, 3]
    assert all(j['prepareJob'] and j['processId'] == process_id for j in jobs)
    assert all(j['channelQueue'] == channel_url for j in jobs)
    # El NIT viaja en el trabajo y los part-files van al bucket por NIT (no al viejo).
    assert all(j['nit'] == '900123' for j in jobs)
    assert all(j['bucket'] == 'mailconnect-900123-database' for j in jobs)

    # Los part-files existen en S3.
    s3 = boto3.client('s3', region_name='us-east-1')
    for j in jobs:
        obj = s3.get_object(Bucket=j['bucket'], Key=j['partKey'])
        assert isinstance(json.loads(obj['Body'].read()), list)

    # El proceso quedó 'Procesando' con el total del spool y el nº de partes (conteos en 0).
    proc = _process(process_id)
    assert proc['processState'] == 'Procesando'
    assert int(proc['registersOnSpool']) == 5
    assert int(proc['parts']) == 3
    assert int(proc['registersToSend']) == 0  # lo acumulan los workers


def test_workers_procesan_partes_y_acumulan(env):
    pb, channel_url, part_url = env
    pb.lambda_handler(_api_event(), None)
    process_id = _campaign()['sendProcessId']
    sqs = boto3.client('sqs', region_name='us-east-1')
    jobs = _drain(sqs, part_url)

    # Corre cada trabajo de parte por el WORKER (evento SQS).
    for j in jobs:
        pb.lambda_handler({'Records': [{'body': json.dumps(j)}]}, None)

    # El canal recibió a los 3 válidos (ana, luis, eva); negro (lista negra) y el
    # malformado NO se encolan.
    channel_msgs = _drain(sqs, channel_url)
    correos = sorted(row[1] for m in channel_msgs for row in m['data'])
    assert correos == ['ana@test.com', 'eva@test.com', 'luis@test.com']
    # Numeración de parte ÚNICA entre partes (no choca → la lambda de envío deduplica bien).
    partes = [m['part'] for m in channel_msgs]
    assert len(partes) == len(set(partes))

    # Conteos ACUMULADOS en el proceso por los workers.
    proc = _process(process_id)
    assert int(proc['registersToSend']) == 3
    assert int(proc['quantityBlacklist']) == 1
    assert int(proc['quantityDeletions']) == 1
    assert int(proc['quantityUnsubscribe']) == 0

    # Estados de los filtrados: 1 inválido (11) + 1 lista negra (13).
    status_tbl = boto3.resource('dynamodb', region_name='us-east-1').Table('empresa_sendStatus')
    rows = status_tbl.query(KeyConditionExpression=Key('processId').eq(process_id))['Items']
    assert sorted(int(r['state']) for r in rows) == [11, 13]


def test_worker_idempotente_no_duplica(env):
    pb, channel_url, part_url = env
    pb.lambda_handler(_api_event(), None)
    process_id = _campaign()['sendProcessId']
    sqs = boto3.client('sqs', region_name='us-east-1')
    jobs = _drain(sqs, part_url)

    for j in jobs:
        pb.lambda_handler({'Records': [{'body': json.dumps(j)}]}, None)
    _drain(sqs, channel_url)  # vacía el canal
    counts_before = {k: int(_process(process_id).get(k, 0))
                     for k in ('registersToSend', 'quantityBlacklist', 'quantityDeletions')}

    # Redelivery de TODAS las partes: no debe re-encolar ni recontar (idempotencia).
    for j in jobs:
        pb.lambda_handler({'Records': [{'body': json.dumps(j)}]}, None)

    assert _drain(sqs, channel_url) == []
    counts_after = {k: int(_process(process_id).get(k, 0))
                    for k in ('registersToSend', 'quantityBlacklist', 'quantityDeletions')}
    assert counts_after == counts_before


def test_split_duplicado_no_retrocea(env):
    # Segundo POST de la MISMA campaña: ya 'Enviando' → el gate de estado la rechaza (404)
    # y NO se trocea de nuevo.
    pb, channel_url, part_url = env
    pb.lambda_handler(_api_event(), None)
    _drain(boto3.client('sqs', region_name='us-east-1'), part_url)

    resp = pb.lambda_handler(_api_event(), None)
    body = json.loads(resp['body'])
    assert body['status'] is False and body['status_code'] == 404
    assert _drain(boto3.client('sqs', region_name='us-east-1'), part_url) == []


def test_split_deshabilitado_da_403(env):
    pb, channel_url, part_url = env
    boto3.resource('dynamodb', region_name='us-east-1').Table('customer').update_item(
        Key={'customerId': 'CU1'},
        UpdateExpression='SET realSendEnabled = :f',
        ExpressionAttributeValues={':f': False})
    resp = pb.lambda_handler(_api_event(), None)
    body = json.loads(resp['body'])
    assert body['status'] is False and body['status_code'] == 403
    assert _campaign()['campaignState'] == 'Pendiente'  # ni Error ni Enviando
