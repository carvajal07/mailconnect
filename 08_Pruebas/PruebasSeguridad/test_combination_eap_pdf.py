"""
Pruebas del combinador EAP-PDF (Api_V1_Template_Combination-EAP-PDF): el consumidor de
la cola Template_Combination-EAP-PDF que renderiza el PDF personalizado por destinatario
y re-emite a Send-EAP.

El render (html_to_pdf) se stubbea para no depender de xhtml2pdf; el stub devuelve el
HTML ya renderizado como bytes, así se verifica la SUSTITUCIÓN de variables además del
key de S3, la forma del re-emit (preserva nit + samples + documentFormat) y el dedup.
"""
import importlib.util
import json
import os
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
import botocore  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DIR = REPO_ROOT / '04_Backend' / 'lambdas'

NIT = '900123'
TENANT = '900123'
CID = 'CU1'
CUST = 'empresa'
CAMP = 'camp-1'
PROC = 'proc-1'
BUCKET = 'mailconnect-900123'
TMPL_KEY = 'attachment/2026-07-22/tmpl.html'


def _load(folder, name):
    p = DIR / folder / 'lambda_function.py'
    spec = importlib.util.spec_from_file_location(name, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def combiner():
    with mock_aws():
        sqs = boto3.client('sqs', region_name='us-east-1')
        q = sqs.create_queue(QueueName='Email_Send-batch-raw-EAP')['QueueUrl']
        os.environ['URL_SQS_EAP'] = q  # el módulo lo lee al importarse

        ddb = boto3.client('dynamodb', region_name='us-east-1')
        ddb.create_table(TableName='document',
                         KeySchema=[{'AttributeName': 'documentId', 'KeyType': 'HASH'}],
                         AttributeDefinitions=[{'AttributeName': 'documentId', 'AttributeType': 'S'}],
                         BillingMode='PAY_PER_REQUEST')
        ddb.create_table(TableName=f'{TENANT}_processDetail',
                         KeySchema=[{'AttributeName': 'processDetailId', 'KeyType': 'HASH'}],
                         AttributeDefinitions=[{'AttributeName': 'processDetailId', 'AttributeType': 'S'}],
                         BillingMode='PAY_PER_REQUEST')

        s3 = boto3.client('s3', region_name='us-east-1')
        s3.create_bucket(Bucket=BUCKET)
        s3.put_object(Bucket=BUCKET, Key=TMPL_KEY, Body=b'<h1>Hola {{nombre}}</h1><p>{{ciudad}}</p>')
        boto3.resource('dynamodb', region_name='us-east-1').Table('document').put_item(
            Item={'documentId': 'd1', 'campaignId': CAMP, 'documentPath': TMPL_KEY})

        mod = _load('Api_V1_Template_Combination-EAP-PDF', 'comb_eap_pdf')
        # Stub del render: devuelve el HTML ya sustituido como "PDF" (bytes).
        mod.html_to_pdf = lambda html, page_size='A4': ('PDF::' + html).encode('utf-8')
        yield mod, sqs, q, s3
        os.environ.pop('URL_SQS_EAP', None)


def _event(data, part=0, samples=False, campaign=CAMP):
    body = {
        'customerId': CID, 'customerName': CUST, 'nit': NIT, 'processId': PROC,
        'campaignId': campaign, 'attachment': True, 'fromEmail': 'no-reply@x.com',
        'headers': ['id', 'email', 'nombre', 'ciudad'], 'templateName': 'tmpl',
        'part': part, 'data': data, 'samples': samples,
    }
    return {'Records': [{'body': json.dumps(body)}]}


def test_renderiza_por_destinatario_y_reemite(combiner):
    mod, sqs, q, s3 = combiner
    data = [['1', 'a@x.com', 'Ana', 'Bogotá'], ['2', 'b@x.com', 'Beto', 'Cali']]
    res = mod.lambda_handler(_event(data, samples=True), None)
    assert res['statusCode'] == 200

    # Un PDF por destinatario, con las variables sustituidas, en el prefijo PRIVADO personalized/.
    ana = s3.get_object(Bucket=BUCKET, Key=f'personalized/{CAMP}/Ana.pdf')['Body'].read().decode()
    assert 'Hola Ana' in ana and 'Bogotá' in ana and '{{nombre}}' not in ana
    s3.get_object(Bucket=BUCKET, Key=f'personalized/{CAMP}/Beto.pdf')  # existe
    # Y NO debe quedar en el prefijo público attachment/.
    with pytest.raises(botocore.exceptions.ClientError):
        s3.get_object(Bucket=BUCKET, Key=f'attachment/{CAMP}/Ana.pdf')

    # Re-emite a Send-EAP preservando nit + samples + documentFormat.
    msgs = sqs.receive_message(QueueUrl=q, MaxNumberOfMessages=10).get('Messages', [])
    assert len(msgs) == 1
    out = json.loads(msgs[0]['Body'])
    assert out['nit'] == NIT
    assert out['samples'] is True
    assert out['documentFormat'] == 'PDF'
    assert out['data'] == data
    assert out['campaignId'] == CAMP and out['templateName'] == 'tmpl'


def test_dedup_parte_repetida(combiner):
    mod, _, _, _ = combiner
    ev = _event([['1', 'a@x.com', 'Ana', 'Bogotá']], part=3)
    assert mod.lambda_handler(ev, None)['statusCode'] == 200
    with pytest.raises(ValueError):
        mod.lambda_handler(ev, None)


def test_sin_plantilla_404(combiner):
    mod, _, _, _ = combiner
    res = mod.lambda_handler(_event([['1', 'a@x.com', 'Ana', 'Bogotá']], campaign='sin-doc'), None)
    assert res['statusCode'] == 404
