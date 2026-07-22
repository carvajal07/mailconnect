"""
Pruebas del generador de PDF síncrono (Api_V1_Template_Render-pdf), el endpoint que
el editor de plantillas PDF llama para previsualizar/generar el documento.

La lógica propia (sustitución de variables, identidad, subida a S3, envelope) se prueba
SIN depender de xhtml2pdf monkeypatcheando `html_to_pdf`. Hay además una prueba de
render REAL protegida por importorskip (corre solo si el layer/paquete está instalado).
"""
import base64
import importlib.util
import os
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DIR = REPO_ROOT / '04_Backend' / 'lambdas'

NIT = '900123'
CID = 'CU1'
CUST = 'empresa'
BUCKET = 'mailconnect-900123'


def _load(folder, name):
    p = DIR / folder / 'lambda_function.py'
    spec = importlib.util.spec_from_file_location(name, str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def mod():
    with mock_aws():
        yield _load('Api_V1_Template_Render-pdf', 'render_pdf')


def _ctx(body):
    return {**body, 'requestContext': {'authorizer': {'nit': NIT, 'customer': CUST, 'customerId': CID}}}


# ---- unidad (sin AWS ni xhtml2pdf) ---------------------------------------
def test_render_variables_sustituye_y_deja_desconocidas(mod):
    html = 'Hola {{ nombre }}, de {{empresa}} — {{no_existe}}'
    out = mod.render_variables(html, {'nombre': 'Ana', 'empresa': 'ACME'})
    assert 'Hola Ana, de ACME' in out
    assert '{{no_existe}}' in out  # las no resueltas se conservan


def test_row_mapping_posicional(mod):
    m = mod.row_mapping(['id', 'email', 'nombre'], ['1', 'a@x.com', 'Ana'])
    assert m == {'id': '1', 'email': 'a@x.com', 'nombre': 'Ana'}


def test_wrap_html_incluye_tamano(mod):
    assert 'size: A4' in mod.wrap_html('<p>x</p>', 'A4')
    assert 'Letter' in mod.wrap_html('<p>x</p>', 'Carta')


# ---- handler (monkeypatch del render) ------------------------------------
def test_403_sin_identidad(mod):
    assert mod.lambda_handler({'html': '<p>x</p>'}, None)['statusCode'] == 403


def test_400_sin_html(mod):
    assert mod.lambda_handler(_ctx({}), None)['statusCode'] == 400


def test_store_false_devuelve_base64(mod, monkeypatch):
    monkeypatch.setattr(mod, 'html_to_pdf', lambda html, page_size='A4': b'%PDF-1.4 fake')
    resp = mod.lambda_handler(_ctx({'html': '<h1>{{nombre}}</h1>', 'variables': {'nombre': 'Ana'}}), None)
    assert resp['statusCode'] == 200
    assert base64.b64decode(resp['data']['pdfBase64'])[:5] == b'%PDF-'
    assert resp['data']['filename'].endswith('.pdf')


def test_store_true_sube_a_s3(mod, monkeypatch):
    monkeypatch.setattr(mod, 'html_to_pdf', lambda html, page_size='A4': b'%PDF-1.4 fake')
    boto3.client('s3', region_name='us-east-1').create_bucket(Bucket=BUCKET)
    resp = mod.lambda_handler(_ctx({'html': '<p>x</p>', 'store': True, 'filename': 'carta'}), None)
    assert resp['statusCode'] == 200
    key = resp['data']['path']
    assert key.startswith('attachment/pdf-preview/') and key.endswith('.pdf')
    body = boto3.client('s3', region_name='us-east-1').get_object(Bucket=BUCKET, Key=key)['Body'].read()
    assert body[:5] == b'%PDF-'


def test_render_error_devuelve_500(mod, monkeypatch):
    def _boom(html, page_size='A4'):
        raise RuntimeError('falta el layer')
    monkeypatch.setattr(mod, 'html_to_pdf', _boom)
    resp = mod.lambda_handler(_ctx({'html': '<p>x</p>'}), None)
    assert resp['statusCode'] == 500
    assert 'layer' in resp['description']


# ---- render REAL (solo si xhtml2pdf está disponible) ---------------------
def test_render_real_produce_pdf(mod):
    pytest.importorskip('xhtml2pdf')
    html = mod.render_variables('<h1>Hola {{nombre}}</h1><p>Prueba</p>', {'nombre': 'Ana'})
    pdf = mod.html_to_pdf(html, 'A4')
    assert pdf[:5] == b'%PDF-'
    assert len(pdf) > 400
