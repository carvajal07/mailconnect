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


# ---- fidelidad con el LIENZO del editor ----------------------------------
# `PdfTemplatesSection.tsx` dibuja la hoja copiando estas medidas (margen, cuerpo y
# títulos). Si cambian aquí y no allá, el editor vuelve a mentir: lo que se ve cabiendo
# en el renglón no cabe en el PDF. Estas pruebas NO necesitan xhtml2pdf.
def test_wrap_html_conserva_las_medidas_que_el_editor_replica(mod):
    out = mod.wrap_html('<p>x</p>', 'A4')
    assert 'margin: 2cm' in out, 'el lienzo dibuja 2cm de margen (PAGE_MARGIN_CM)'
    assert 'font-size: 12pt' in out, 'el lienzo usa 12pt de cuerpo (BODY_PT)'
    for etiqueta, pt in (('h1', 22), ('h2', 18), ('h3', 15)):
        assert '%s { font-size: %dpt; }' % (etiqueta, pt) in out, \
            '%s cambió de tamaño; actualizar HEADING_PT en el editor' % etiqueta


def test_wrap_html_respeta_el_tamano_de_hoja(mod):
    assert 'size: A4' in mod.wrap_html('<p>x</p>', 'A4')
    assert 'size: Letter' in mod.wrap_html('<p>x</p>', 'Carta')


def test_el_envoltorio_del_editor_lleva_su_fuente_al_pdf(mod):
    """El editor envuelve el documento en `<div data-mc-doc style="font-family:…">`.

    ⚠️ Es lo ÚNICO que hace llegar la fuente elegida al PDF: `wrap_html` fija
    `body { font-family: Arial… }`, así que sin el envoltorio todo sale en Helvetica por
    más que el lienzo se vea en otra tipografía. Se verifica leyendo los /BaseFont del PDF.
    """
    import re
    pytest.importorskip('xhtml2pdf')

    def fuentes(html):
        return {m.decode() for m in re.findall(rb'/BaseFont\s*/([A-Za-z0-9\-\+,]+)',
                                               mod.html_to_pdf(html, 'A4'))}

    envuelto = ('<div data-mc-doc="1" style="font-family:Times New Roman">'
                '<p>Hola</p><table><tr><td>Celda</td></tr></table></div>')
    assert any(f.startswith('Times') for f in fuentes(envuelto))
    # Sin envoltorio queda la fuente del body: el comportamiento viejo.
    assert not any(f.startswith('Times') for f in fuentes('<p>Hola</p>'))


def test_solo_se_ofrecen_fuentes_que_el_pdf_puede_entregar(mod):
    """Guard del catálogo del editor (`FONTS`).

    xhtml2pdf solo tiene las base-14 del estándar PDF porque la lambda no registra
    tipografías. Verdana y Tahoma caen a Helvetica (idénticas a Arial) y Georgia cae a
    Times: ofrecerlas era prometer seis resultados y entregar tres. Si algún día se
    registran fuentes reales, esta prueba es el recordatorio de ampliar el catálogo.
    """
    import re
    pytest.importorskip('xhtml2pdf')
    seccion = (REPO_ROOT / '05_Frontend' / 'Front' / 'page' / 'src' / 'components' /
               'portal' / 'PdfTemplatesSection.tsx').read_text(encoding='utf-8')
    bloque = re.search(r'const FONTS[^=]*=\s*\[(.*?)\];', seccion, re.S)
    assert bloque, 'no se encontró el catálogo FONTS del editor'
    ofrecidas = re.findall(r"value:\s*'([^']+)'", bloque.group(1))
    assert ofrecidas, 'el catálogo quedó vacío'

    def base_font(nombre):
        pdf = mod.html_to_pdf('<p style="font-family:%s">x</p>' % nombre, 'A4')
        return {m.decode().split('-')[0]
                for m in re.findall(rb'/BaseFont\s*/([A-Za-z0-9\-\+,]+)', pdf)}

    vistas = {}
    for f in ofrecidas:
        # Helvetica aparece siempre (es la del body), así que se descuenta salvo que sea
        # el único resultado — que es justo el caso de Arial.
        familia = frozenset(base_font(f) - {'Helvetica'}) or frozenset({'Helvetica'})
        assert familia not in vistas, \
            '"%s" produce el mismo PDF que "%s" (%s): una de las dos sobra' % (
                f, vistas[familia], set(familia))
        vistas[familia] = f
