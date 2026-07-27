"""Pruebas de `Api_V1_Cost_Attachment-weight` (peso REAL del adjunto de una campaña).

Lo que se fija aquí es el criterio de medición, que es lo que decide cuánto se cobra:
  · EAU  → tamaño EXACTO del archivo en S3, SIN margen (es el mismo adjunto para todos).
  · EAP-PDF → se renderiza un PDF por REGISTRO REAL de la base y se promedia + margen.
  · EAP-DOCX → aproximación sobre la plantilla + margen (el combinado pesa casi igual).
Y los gates: sin sesión, campaña de otro cliente, canal sin adjunto.
"""
import importlib.util
import json
import sys
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

sys.path.insert(0, str(Path(__file__).resolve().parent))

LAMBDAS = Path(__file__).resolve().parents[2] / '04_Backend' / 'lambdas'

NIT = '900123456'
TENANT = '900123456'
BUCKET = 'mailconnect-' + TENANT
CUSTOMER_ID = 'CU1'


def _load():
    spec = importlib.util.spec_from_file_location(
        'weight_mod', str(LAMBDAS / 'Api_V1_Cost_Attachment-weight' / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _event(body=None, customer_id=CUSTOMER_ID):
    return {**(body or {}),
            'requestContext': {'authorizer': {
                'customerId': customer_id, 'customer': 'Beta', 'nit': NIT}}}


CSV = ('Identificacion;Correo;Nombre;Saldo\n'
       '1;a@x.com;Ana;100\n'
       '2;b@x.com;Beto;200\n'
       '3;c@x.com;Caro;300\n')


@pytest.fixture
def env():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        for name, pk in (('campaign', 'campaignId'), ('document', 'documentId'),
                         ('databaseFile', 'databaseFileId')):
            ddb.create_table(TableName=name,
                             KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
                             AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
                             BillingMode='PAY_PER_REQUEST')
        s3 = boto3.client('s3', region_name='us-east-1')
        s3.create_bucket(Bucket=BUCKET)
        s3.put_object(Bucket=BUCKET, Key='database/base.csv', Body=CSV.encode('utf-8'))
        yield _load()


def _campaign(res, channel='EAP', fmt='PDF', data_path='database/base.csv',
              customer_id=CUSTOMER_ID):
    res.Table('campaign').put_item(Item={
        'campaignId': 'C1', 'customerId': customer_id, 'campaignName': 'Extractos',
        'channelName': channel, 'dataPath': data_path, 'documentFormat': fmt})


def _document(res, path, fmt='PDF'):
    res.Table('document').put_item(Item={
        'documentId': 'D1', 'campaignId': 'C1', 'documentPath': path,
        'documentFormat': fmt, 'attachmentType': 'ONFILE'})


# ── Gates ────────────────────────────────────────────────────────────────────

def test_sin_sesion_403(env):
    assert env.lambda_handler({'campaignId': 'C1'}, None)['statusCode'] == 403


def test_sin_campaign_id_400(env):
    assert env.lambda_handler(_event(), None)['statusCode'] == 400


def test_campana_de_otro_cliente_403(env):
    res = boto3.resource('dynamodb', region_name='us-east-1')
    _campaign(res, customer_id='OTRO')
    assert env.lambda_handler(_event({'campaignId': 'C1'}), None)['statusCode'] == 403


def test_canal_sin_adjunto_400(env):
    """EM no lleva adjunto: no hay peso que medir (y el estimador no lo usa)."""
    res = boto3.resource('dynamodb', region_name='us-east-1')
    _campaign(res, channel='EM')
    out = env.lambda_handler(_event({'campaignId': 'C1'}), None)
    assert out['statusCode'] == 400
    assert 'adjunto' in out['description'].lower()


def test_sin_documento_registrado_404(env):
    res = boto3.resource('dynamodb', region_name='us-east-1')
    _campaign(res)
    assert env.lambda_handler(_event({'campaignId': 'C1'}), None)['statusCode'] == 404


# ── EAU: medida EXACTA, sin margen ───────────────────────────────────────────

def test_eau_mide_exacto_sin_margen(env):
    """El adjunto de EAU ya existe y es el mismo para todos → no se estima ni se
    infla con margen: se reporta el tamaño real del objeto en S3."""
    res = boto3.resource('dynamodb', region_name='us-east-1')
    s3 = boto3.client('s3', region_name='us-east-1')
    blob = b'x' * (3 * 1024 * 1024)          # 3 MB exactos
    s3.put_object(Bucket=BUCKET, Key='attachment/manual.pdf', Body=blob)
    _campaign(res, channel='EAU', fmt='')
    _document(res, 'attachment/manual.pdf', fmt='')

    out = env.lambda_handler(_event({'campaignId': 'C1'}), None)
    assert out['statusCode'] == 200
    data = out['data']
    assert data['exact'] is True
    assert data['mode'] == 'EAU'
    assert data['samples'] == 1
    assert data['marginPct'] == 0
    assert data['avgBytes'] == len(blob)
    assert data['sizeMB'] == 3.0             # sin margen: 3 MB son 3 MB


# ── EAP-DOCX: aproximación sobre la plantilla + margen ───────────────────────

def test_eap_docx_aproxima_con_margen(env):
    res = boto3.resource('dynamodb', region_name='us-east-1')
    s3 = boto3.client('s3', region_name='us-east-1')
    s3.put_object(Bucket=BUCKET, Key='attachment/plantilla.docx', Body=b'y' * (1024 * 1024))
    _campaign(res, channel='EAP', fmt='DOCX')
    _document(res, 'attachment/plantilla.docx', fmt='DOCX')

    out = env.lambda_handler(_event({'campaignId': 'C1'}), None)
    assert out['statusCode'] == 200
    data = out['data']
    assert data['exact'] is False
    assert data['marginPct'] == 20
    assert data['sizeMB'] == pytest.approx(1.2, abs=0.01)   # 1 MB + 20%


# ── EAP-PDF: renderiza registros REALES y promedia ───────────────────────────

def _fake_invoke(sizes):
    """Simula las lambdas de render: devuelve un PDF de tamaño distinto por llamada,
    como pasa de verdad (cada destinatario genera un PDF de peso diferente)."""
    import base64
    calls = {'n': 0, 'payloads': []}

    class FakeBody:
        def __init__(self, data):
            self._data = data

        def read(self):
            return self._data

    def invoke(FunctionName, InvocationType, Payload):
        calls['payloads'].append(json.loads(Payload.decode('utf-8')))
        size = sizes[min(calls['n'], len(sizes) - 1)]
        calls['n'] += 1
        body = {'status': True, 'statusCode': 200, 'description': 'ok',
                'data': {'pdfBase64': base64.b64encode(b'p' * size).decode()}}
        return {'Payload': FakeBody(json.dumps(body).encode('utf-8'))}

    return invoke, calls


def test_eap_pdf_promedia_pdfs_de_registros_reales(env, monkeypatch):
    res = boto3.resource('dynamodb', region_name='us-east-1')
    s3 = boto3.client('s3', region_name='us-east-1')
    sketch = json.dumps({'schema': 'pdfsketch@1', 'document': {'pages': []}})
    s3.put_object(Bucket=BUCKET, Key='attachment/plantilla.json', Body=sketch.encode())
    _campaign(res, channel='EAP', fmt='PDF')
    _document(res, 'attachment/plantilla.json')

    # 1 MB, 2 MB y 3 MB → promedio 2 MB; con el margen del 20% → 2.4 MB.
    mb = 1024 * 1024
    invoke, calls = _fake_invoke([1 * mb, 2 * mb, 3 * mb])
    monkeypatch.setattr(env.lambda_client, 'invoke', invoke)

    out = env.lambda_handler(_event({'campaignId': 'C1'}), None)
    assert out['statusCode'] == 200
    data = out['data']
    assert data['mode'] == 'EAP' and data['format'] == 'PDF'
    assert data['exact'] is False
    assert data['samples'] == 3                     # las 3 filas de la base
    assert data['avgBytes'] == 2 * mb
    assert data['minBytes'] == 1 * mb and data['maxBytes'] == 3 * mb
    assert data['sizeMB'] == pytest.approx(2.4, abs=0.01)

    # Se renderizó con los DATOS REALES de cada fila (no con la plantilla vacía).
    nombres = [p['data']['Nombre'] for p in calls['payloads']]
    assert nombres == ['Ana', 'Beto', 'Caro']
    # ...y con la plantilla del Estudio, por el renderizador del motor.
    assert all('sketch' in p for p in calls['payloads'])
    assert all(p['store'] is False for p in calls['payloads'])   # no deja basura en S3


def test_eap_pdf_respeta_el_tope_de_muestras(env, monkeypatch):
    """`samples` acota cuántos PDFs se generan: cada uno cuesta una invocación."""
    res = boto3.resource('dynamodb', region_name='us-east-1')
    s3 = boto3.client('s3', region_name='us-east-1')
    s3.put_object(Bucket=BUCKET, Key='attachment/p.html', Body=b'<p>{{Nombre}}</p>')
    _campaign(res, channel='EAP', fmt='PDF')
    _document(res, 'attachment/p.html')

    invoke, calls = _fake_invoke([1024 * 1024])
    monkeypatch.setattr(env.lambda_client, 'invoke', invoke)

    out = env.lambda_handler(_event({'campaignId': 'C1', 'samples': 2}), None)
    assert out['statusCode'] == 200
    assert out['data']['samples'] == 2
    assert calls['n'] == 2
    # HTML del editor básico → va por Render-pdf con `variables`, no por el motor.
    assert all('html' in p and 'variables' in p for p in calls['payloads'])


def test_eap_pdf_sin_render_devuelve_502(env, monkeypatch):
    """Si ningún PDF se pudo generar NO se inventa un peso: se avisa el fallo."""
    res = boto3.resource('dynamodb', region_name='us-east-1')
    s3 = boto3.client('s3', region_name='us-east-1')
    s3.put_object(Bucket=BUCKET, Key='attachment/p.html', Body=b'<p>x</p>')
    _campaign(res, channel='EAP', fmt='PDF')
    _document(res, 'attachment/p.html')

    def fail(**kwargs):
        raise RuntimeError('layer sin reportlab')

    monkeypatch.setattr(env.lambda_client, 'invoke', fail)
    out = env.lambda_handler(_event({'campaignId': 'C1'}), None)
    assert out['statusCode'] == 502


def test_celdas_json_llegan_parseadas_al_motor(env, monkeypatch):
    """Una base con arrays embebidos (extractos) alimenta tablas con repetición: si la
    celda llegara como TEXTO, el PDF de muestra saldría sin la tabla y el peso medido
    sería mucho menor que el real."""
    res = boto3.resource('dynamodb', region_name='us-east-1')
    s3 = boto3.client('s3', region_name='us-east-1')
    movimientos = json.dumps([{'fecha': '01-01', 'valor': 10}, {'fecha': '02-01', 'valor': 20}])
    csv_json = ('Identificacion;Correo;Nombre;Movimientos\n'
                '1;a@x.com;Ana;{}\n'.format(movimientos.replace(';', ',')))
    s3.put_object(Bucket=BUCKET, Key='database/ext.csv', Body=csv_json.encode('utf-8'))
    s3.put_object(Bucket=BUCKET, Key='attachment/p.json',
                  Body=json.dumps({'schema': 'pdfsketch@1', 'document': {}}).encode())
    _campaign(res, channel='EAP', fmt='PDF', data_path='database/ext.csv')
    _document(res, 'attachment/p.json')

    invoke, calls = _fake_invoke([1024])
    monkeypatch.setattr(env.lambda_client, 'invoke', invoke)

    out = env.lambda_handler(_event({'campaignId': 'C1'}), None)
    assert out['statusCode'] == 200
    enviado = calls['payloads'][0]['data']['Movimientos']
    assert isinstance(enviado, list) and len(enviado) == 2
