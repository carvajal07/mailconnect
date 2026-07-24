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
import sys
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
    # El combinador vendoriza el motor (importa sketch_translator + pdf_engine a nivel de
    # módulo) → su carpeta debe estar en sys.path y se limpian los módulos cacheados para no
    # chocar con la copia del test del motor (mismo nombre, contenido idéntico).
    d = DIR / folder
    if str(d) not in sys.path:
        sys.path.insert(0, str(d))
    for mod_name in list(sys.modules):
        if mod_name == 'sketch_translator' or mod_name.startswith('pdf_engine'):
            del sys.modules[mod_name]
    p = d / 'lambda_function.py'
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
    mod, sqs, q, _ = combiner
    ev = _event([['1', 'a@x.com', 'Ana', 'Bogotá']], part=3)
    # Primera entrega: reclama la parte (claim atómico 'combine'), genera y re-emite.
    assert mod.lambda_handler(ev, None)['statusCode'] == 200
    # Redelivery de la MISMA parte: el claim atómico ya no gana → se OMITE de forma idempotente
    # (statusCode 200, SIN raise, para que SQS borre el duplicado en vez de reintentarlo).
    res2 = mod.lambda_handler(ev, None)
    assert res2['statusCode'] == 200
    # Garantía clave: pese a las DOS entregas, solo UN mensaje llegó a Send-EAP (no se duplica
    # el envío aguas abajo).
    msgs = sqs.receive_message(QueueUrl=q, MaxNumberOfMessages=10, WaitTimeSeconds=0).get('Messages', [])
    assert len(msgs) == 1


def test_sin_plantilla_404(combiner):
    mod, _, _, _ = combiner
    res = mod.lambda_handler(_event([['1', 'a@x.com', 'Ana', 'Bogotá']], campaign='sin-doc'), None)
    assert res['statusCode'] == 404


def test_renderiza_plantilla_estudio_con_variables(combiner):
    # Plantilla del ESTUDIO PDF (sketchJson): el combinador la detecta como JSON, la
    # traduce y la renderiza con el MOTOR (ReportLab) pasando la fila del CSV como data →
    # las variables (dataField `nombre`, texto `{{ciudad}}`) se resuelven por destinatario.
    mod, sqs, q, s3 = combiner
    sketch = {'schema': 'pdfsketch@1', 'document': {
        'unit': 'mm',
        'pages': [{'size': {'width': 210, 'height': 297, 'unit': 'mm'}, 'margin': {}, 'elements': [
            {'id': 'df', 'type': 'dataField', 'x': 20, 'y': 20, 'width': 100, 'height': 10,
             'binding': 'nombre', 'fallback': '', 'fontFamily': 'Helvetica', 'fontSize': 14, 'color': '#111111'},
            {'id': 't', 'type': 'text', 'x': 20, 'y': 40, 'width': 120, 'height': 10,
             'text': 'Ciudad: {{ciudad}}', 'align': 'left', 'fontFamily': 'Helvetica',
             'fontSize': 12, 'color': '#111111', 'fontWeight': 400, 'lineHeight': 1.3},
        ]}],
    }}
    key = 'attachment/2026-07-22/estudio.json'
    s3.put_object(Bucket=BUCKET, Key=key, Body=json.dumps(sketch).encode(), ContentType='application/json')
    boto3.resource('dynamodb', region_name='us-east-1').Table('document').put_item(
        Item={'documentId': 'd2', 'campaignId': 'camp-estudio', 'documentPath': key})

    data = [['1', 'a@x.com', 'Ana', 'Bogotá']]
    res = mod.lambda_handler(_event(data, campaign='camp-estudio'), None)
    assert res['statusCode'] == 200
    # PDF REAL del motor (no el stub HTML) → el pipeline del lienzo funciona de punta a punta.
    pdf = s3.get_object(Bucket=BUCKET, Key='personalized/camp-estudio/Ana.pdf')['Body'].read()
    assert pdf[:5] == b'%PDF-'
    # Se re-emite a Send-EAP como cualquier EAP-PDF.
    msgs = sqs.receive_message(QueueUrl=q, MaxNumberOfMessages=10).get('Messages', [])
    assert len(msgs) == 1 and json.loads(msgs[0]['Body'])['documentFormat'] == 'PDF'


def test_parse_template_content_detecta_formato(combiner):
    mod, _, _, _ = combiner
    kind, _ = mod.parse_template_content('<h1>Hola {{nombre}}</h1>')
    assert kind == 'html'
    kind, tj = mod.parse_template_content(json.dumps(
        {'schema': 'pdfsketch@1', 'document': {'unit': 'mm', 'pages': [
            {'size': {'width': 210, 'height': 297, 'unit': 'mm'}, 'margin': {}, 'elements': []}]}}))
    assert kind == 'template' and isinstance(tj.get('pages'), list)
