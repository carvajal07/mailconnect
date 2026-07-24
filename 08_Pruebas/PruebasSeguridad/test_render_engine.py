"""
Pruebas del MOTOR DE PDF ESTÁNDAR (Api_V1_Template_Render-engine) y del traductor
pdfsketch → templateJson (sketch_translator).

El motor es el pdf_engine vendorizado (ReportLab): se prueba el render REAL
(reportlab está en requirements de la suite), el contrato del handler (envelope,
identidad, S3 con moto) y el mapeo del traductor elemento por elemento.
"""
import base64
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
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
ENGINE_DIR = REPO_ROOT / '04_Backend' / 'lambdas' / 'Api_V1_Template_Render-engine'
LAMBDAS_DIR = REPO_ROOT / '04_Backend' / 'lambdas'

NIT = '900123'
CID = 'CU1'
CUST = 'empresa'
BUCKET = 'mailconnect-900123'


def _load_engine():
    """Carga la lambda del motor con su carpeta en sys.path (importa
    sketch_translator y el paquete pdf_engine por nombre)."""
    if str(ENGINE_DIR) not in sys.path:
        sys.path.insert(0, str(ENGINE_DIR))
    # Limpiar módulos cacheados de una carga anterior (aislamiento entre tests).
    for name in list(sys.modules):
        if name == 'sketch_translator' or name.startswith('pdf_engine'):
            del sys.modules[name]
    spec = importlib.util.spec_from_file_location('render_engine', str(ENGINE_DIR / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _load_mt_create():
    p = LAMBDAS_DIR / 'Api_V1_MessageTemplate_Create' / 'lambda_function.py'
    spec = importlib.util.spec_from_file_location('mt_create', str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def mod():
    with mock_aws():
        yield _load_engine()


def _ctx(body, nit=NIT, customer=CUST, customer_id=CID):
    return {
        'body': body,
        'requestContext': {'authorizer': {'nit': nit, 'customer': customer, 'customerId': customer_id}},
    }


def _pdf_bytes(res):
    assert res['statusCode'] == 200, res
    return base64.b64decode(res['data']['pdfBase64'])


MINIMAL_TEMPLATE = {
    'version': '1.0',
    'styles': {
        'text': [{'id': 'ts_default', 'name': 'Default', 'fontFamily': 'Helvetica',
                  'fontWeight': 'Regular', 'fontSize': 12, 'color': '#111111',
                  'italic': False, 'underline': False, 'strikethrough': False,
                  'letterSpacing': 0, 'lineHeight': 1.4, 'textTransform': 'none'}],
        'paragraph': [], 'border': [], 'fill': [], 'cell': [], 'line': [],
    },
    'images': [], 'fonts': [],
    'pages': [{
        'id': 'pg1', 'name': 'P1', 'visible': True,
        'size': {'width': 210, 'height': 297, 'unit': 'mm'},
        'margins': {'top': 20, 'right': 20, 'bottom': 20, 'left': 20},
        'background': {'type': 'none'},
        'elements': [
            {'id': 'ca1', 'type': 'contentarea', 'x': 20, 'y': 20, 'width': 170, 'height': 40,
             'visible': True, 'condition': None, 'areaRef': 'a1', 'border': None, 'fill': None},
            {'id': 'sh1', 'type': 'shape', 'shape': 'rectangle', 'x': 20, 'y': 80,
             'width': 60, 'height': 25, 'visible': True, 'condition': None,
             'fill': {'type': 'solid', 'color': '#dbeafe', 'opacity': 1},
             'border': {'mode': 'unified', 'unified': {'enabled': True, 'width': 0.5,
                        'style': 'solid', 'color': '#3b82f6'}, 'sides': {},
                        'radius': {'mode': 'unified', 'unified': 2}}},
        ],
    }],
    'contentAreas': [{
        'id': 'a1', 'type': 'simple', 'label': 'A1', 'height': 40,
        'content': 'Hola <span class="var-tag" data-var="nombre">{{nombre}}</span>',
        'elements': [], 'children': [], 'visible': True, 'condition': None,
        'defaultTextStyleId': 'ts_default',
    }],
}

SKETCH_DOC = {
    'id': 'd1', 'name': 'Doc de prueba', 'unit': 'mm',
    'pages': [{
        'id': 'p1', 'name': 'P1',
        'size': {'width': 210, 'height': 297, 'unit': 'mm'},
        'background': '#ffffff',
        'margin': {'top': 15, 'right': 15, 'bottom': 15, 'left': 15},
        'rotation': 0, 'visible': True, 'weight': 1, 'repeatedBy': 'Empty', 'addHeight': 0,
        'elements': [
            {'id': 't1', 'type': 'text', 'x': 15, 'y': 15, 'width': 100, 'height': 12,
             'rotation': 0, 'visible': True, 'locked': False, 'zIndex': 1,
             'text': 'Factura', 'fontFamily': 'Helvetica', 'fontSize': 18,
             'fontStyle': 'normal', 'fontWeight': 700, 'align': 'left',
             'lineHeight': 1.2, 'color': '#16233f'},
            {'id': 't2', 'type': 'text', 'x': 15, 'y': 30, 'width': 120, 'height': 10,
             'rotation': 0, 'visible': True, 'locked': False, 'zIndex': 2,
             'text': 'Cliente: {{cliente.nombre}}', 'fontFamily': 'Helvetica',
             'fontSize': 11, 'fontStyle': 'normal', 'fontWeight': 400,
             'align': 'left', 'lineHeight': 1.3, 'color': '#111111'},
            {'id': 'df1', 'type': 'dataField', 'x': 15, 'y': 42, 'width': 80, 'height': 8,
             'rotation': 0, 'visible': True, 'locked': False, 'zIndex': 3,
             'binding': 'factura.numero', 'fallback': '', 'fontFamily': 'Helvetica',
             'fontSize': 10, 'color': '#333333'},
            {'id': 'r1', 'type': 'rect', 'x': 15, 'y': 55, 'width': 60, 'height': 20,
             'rotation': 0, 'visible': True, 'locked': False, 'zIndex': 4,
             'fill': '#eef2ff', 'stroke': '#4f46e5', 'strokeWidth': 1, 'cornerRadius': 3},
            {'id': 'tb1', 'type': 'table', 'x': 15, 'y': 85, 'width': 180, 'height': 60,
             'rotation': 0, 'visible': True, 'locked': False, 'zIndex': 5,
             'columns': [{'widthPercent': 50, 'minWidth': 10, 'header': 'Concepto'},
                         {'widthPercent': 50, 'minWidth': 10, 'header': 'Valor'}],
             'rows': [[{'text': 'Concepto'}, {'text': 'Valor'}],
                      [{'text': 'Servicio A'}, {'text': '100'}],
                      [{'text': 'Servicio B'}, {'text': '200'}]],
             'borderWidth': 1, 'borderColor': '#94a3b8', 'cellSpacing': 0,
             'hasHeader': True, 'hasFooter': False, 'headerBackground': '#f1f5f9',
             'footerBackground': '', 'alternateRows': True,
             'alternateBackground': '#f8fafc', 'rowFontSize': 9},
            {'id': 'q1', 'type': 'qr', 'x': 160, 'y': 15, 'width': 30, 'height': 30,
             'rotation': 0, 'visible': True, 'locked': False, 'zIndex': 6,
             'barcodeType': 'QR', 'data': 'https://mailconnect.com.co',
             'errorLevel': 'M', 'moduleSize': 4, 'showText': False},
            {'id': 'pen1', 'type': 'pen', 'x': 0, 'y': 0, 'width': 10, 'height': 10,
             'rotation': 0, 'visible': True, 'locked': False, 'zIndex': 7,
             'points': [0, 0, 5, 5], 'stroke': '#000', 'strokeWidth': 1, 'tension': 0.5},
        ],
    }],
    'assets': {}, 'data': {'variables': [], 'datasets': []},
    'dynamicComms': [], 'flows': [],
    'createdAt': '2026-01-01', 'updatedAt': '2026-01-01',
}


# ── Render del templateJson (nivel FULL) ──────────────────────────────────────

def test_render_template_json_minimal(mod):
    res = mod.lambda_handler(_ctx({'templateJson': MINIMAL_TEMPLATE,
                                   'data': {'nombre': 'Ana'}}), None)
    pdf = _pdf_bytes(res)
    assert pdf[:4] == b'%PDF'
    assert len(pdf) > 500
    assert res['data']['warnings'] == []


# ── Render del sketch (nivel MEDIO, con traducción) ───────────────────────────

def test_render_sketch_end_to_end(mod):
    body = {'sketch': {'schema': 'pdfsketch@1', 'document': SKETCH_DOC},
            'data': {'cliente': {'nombre': 'Ana'}, 'factura': {'numero': 'F-001'}},
            'filename': 'factura.pdf'}
    res = mod.lambda_handler(_ctx(body), None)
    pdf = _pdf_bytes(res)
    assert pdf[:4] == b'%PDF'
    assert res['data']['filename'] == 'factura.pdf'
    # El trazo libre (pen) no está soportado → warning, sin romper el render.
    assert any('pen' in w for w in res['data']['warnings'])


def test_render_sketch_document_directo(mod):
    """El DocumentModel sin envelope también se acepta."""
    res = mod.lambda_handler(_ctx({'sketch': SKETCH_DOC, 'data': {}}), None)
    assert _pdf_bytes(res)[:4] == b'%PDF'


# ── Contrato del handler ──────────────────────────────────────────────────────

def test_sin_identidad_403(mod):
    res = mod.lambda_handler({'body': {'templateJson': MINIMAL_TEMPLATE}}, None)
    assert res['statusCode'] == 403


def test_sin_plantilla_400(mod):
    res = mod.lambda_handler(_ctx({'data': {'x': 1}}), None)
    assert res['statusCode'] == 400


def test_store_sube_a_s3(mod):
    res = mod.lambda_handler(_ctx({'templateJson': MINIMAL_TEMPLATE, 'store': True,
                                   'filename': 'doc.pdf'}), None)
    assert res['statusCode'] == 200, res
    key = res['data']['path']
    assert key.startswith('attachment/pdf-preview/')
    s3 = boto3.client('s3', region_name='us-east-1')
    obj = s3.get_object(Bucket=BUCKET, Key=key)
    assert obj['Body'].read()[:4] == b'%PDF'


def test_plantilla_guardada_por_id(mod):
    ddb = boto3.client('dynamodb', region_name='us-east-1')
    ddb.create_table(TableName='messageTemplate',
                     KeySchema=[{'AttributeName': 'messageTemplateId', 'KeyType': 'HASH'}],
                     AttributeDefinitions=[{'AttributeName': 'messageTemplateId', 'AttributeType': 'S'}],
                     BillingMode='PAY_PER_REQUEST')
    boto3.resource('dynamodb', region_name='us-east-1').Table('messageTemplate').put_item(Item={
        'messageTemplateId': 'MT1', 'customerId': CID, 'channel': 'PDF',
        'sketchJson': json.dumps({'schema': 'pdfsketch@1', 'document': SKETCH_DOC}),
    })
    res = mod.lambda_handler(_ctx({'messageTemplateId': 'MT1', 'data': {}}), None)
    assert _pdf_bytes(res)[:4] == b'%PDF'

    # Plantilla de otro tenant → 400 con mensaje de cuenta.
    boto3.resource('dynamodb', region_name='us-east-1').Table('messageTemplate').put_item(Item={
        'messageTemplateId': 'MT2', 'customerId': 'OTRO', 'channel': 'PDF',
        'sketchJson': json.dumps(SKETCH_DOC),
    })
    res2 = mod.lambda_handler(_ctx({'messageTemplateId': 'MT2'}), None)
    assert res2['statusCode'] == 400
    assert 'cuenta' in res2['description']


# ── Traductor: mapeo elemento por elemento ────────────────────────────────────

def test_traductor_mapeo_elementos(mod):
    from sketch_translator import translate_sketch
    out = translate_sketch({'schema': 'pdfsketch@1', 'document': SKETCH_DOC})
    tj = out['templateJson']
    page = tj['pages'][0]
    by_type = {}
    for el in page['elements']:
        by_type.setdefault(el['type'], []).append(el)

    # text sin variables → 'text'; text con {{}} y dataField → 'contentarea'
    assert len(by_type.get('text', [])) == 1
    assert by_type['text'][0]['content'] == 'Factura'
    assert len(by_type.get('contentarea', [])) == 2
    # Las áreas del pool llevan var-tags con la ruta de punto
    contents = [a['content'] for a in tj['contentAreas']]
    assert any('data-var="cliente.nombre"' in c for c in contents)
    assert any('data-var="factura.numero"' in c for c in contents)

    # rect → shape rectangle con fill y borde unificado
    shapes = by_type.get('shape', [])
    assert shapes and shapes[0]['shape'] == 'rectangle'
    assert shapes[0]['fill'] == {'type': 'solid', 'color': '#eef2ff', 'opacity': 1}
    assert shapes[0]['border']['unified']['enabled'] is True

    # table → modelo simple del motor (header + body + cebra)
    tables = by_type.get('table', [])
    assert tables
    t = tables[0]
    assert t['header']['enabled'] is True
    assert len(t['body']['rows']) == 2  # la fila de encabezado se separa del body
    assert t['columns'][0]['widthUnit'] == '%'
    assert t['alternateRowFill']['color'] == '#f8fafc'

    # qr → qr estático
    qrs = by_type.get('qr', [])
    assert qrs and qrs[0]['valueSource'] == 'static'
    assert qrs[0]['value'] == 'https://mailconnect.com.co'

    # pen omitido con warning
    assert any('pen' in w for w in out['warnings'])


def test_traductor_convierte_unidades_pt(mod):
    from sketch_translator import translate_sketch
    doc = {'unit': 'pt', 'pages': [{'size': {'width': 612, 'height': 792, 'unit': 'pt'},
                                    'margin': {}, 'elements': [
        {'id': 'e1', 'type': 'rect', 'x': 72, 'y': 72, 'width': 144, 'height': 72,
         'fill': '#ffffff', 'stroke': '#000000', 'strokeWidth': 1, 'cornerRadius': 0},
    ]}]}
    tj = translate_sketch(doc)['templateJson']
    page = tj['pages'][0]
    assert round(page['size']['width'], 1) == 215.9   # 612 pt = carta
    el = page['elements'][0]
    assert round(el['x'], 1) == 25.4                  # 72 pt = 1 pulgada
    assert round(el['width'], 1) == 50.8


def test_traductor_rechaza_json_invalido(mod):
    from sketch_translator import translate_sketch
    with pytest.raises(ValueError):
        translate_sketch({'schema': 'pdfsketch@1', 'document': {'sinPages': True}})


# ── MessageTemplate_Create: canal PDF con los nuevos formatos ─────────────────

@pytest.fixture
def mt_create():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        for name, pk in (('messageTemplate', 'messageTemplateId'), ('adminAudit', 'auditId')):
            ddb.create_table(TableName=name,
                             KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
                             AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
                             BillingMode='PAY_PER_REQUEST')
        yield _load_mt_create()


def test_mt_create_pdf_acepta_sketch_json(mt_create):
    res = mt_create.lambda_handler(_ctx({
        'channel': 'PDF', 'name': 'Mi sketch', 'customerId': CID,
        'sketchJson': {'schema': 'pdfsketch@1', 'document': SKETCH_DOC},
    }), None)
    assert res['statusCode'] == 201, res
    item = boto3.resource('dynamodb', region_name='us-east-1').Table('messageTemplate') \
        .get_item(Key={'messageTemplateId': res['data']['messageTemplateId']})['Item']
    assert item['channel'] == 'PDF'
    stored = json.loads(item['sketchJson'])
    assert stored['document']['pages'][0]['elements'][0]['type'] == 'text'


def test_mt_create_pdf_acepta_template_json(mt_create):
    res = mt_create.lambda_handler(_ctx({
        'channel': 'PDF', 'name': 'Mi diseño full', 'customerId': CID,
        'templateJson': MINIMAL_TEMPLATE,
    }), None)
    assert res['statusCode'] == 201, res


def test_mt_create_pdf_sin_contenido_400(mt_create):
    res = mt_create.lambda_handler(_ctx({
        'channel': 'PDF', 'name': 'Vacía', 'customerId': CID,
    }), None)
    assert res['statusCode'] == 400


# ── Fidelidad lienzo ↔ PDF (fixes jul 2026) ──────────────────────────────────

def test_traductor_borde_de_forma_en_mm(mod):
    # El editor captura el grosor en mm y el motor lo espera en mm → pasa DIRECTO.
    # (Regresión: se multiplicaba por MM_PER_PT y un borde de 1 mm salía de 0.35 mm.)
    from sketch_translator import translate_sketch
    doc = {'unit': 'mm', 'pages': [{'size': {'width': 210, 'height': 297, 'unit': 'mm'},
                                    'margin': {}, 'elements': [
        {'id': 'r1', 'type': 'rect', 'x': 10, 'y': 10, 'width': 50, 'height': 20,
         'fill': '#ffffff', 'stroke': '#000000', 'strokeWidth': 1, 'cornerRadius': 0},
    ]}]}
    el = translate_sketch(doc)['templateJson']['pages'][0]['elements'][0]
    assert el['border']['unified']['width'] == 1.0


def test_traductor_linea_diagonal_como_rect_rotado(mod):
    # Una línea diagonal debe salir como rectángulo DELGADO rotado su ángulo
    # (antes se emitía el bounding box relleno: un bloque sólido de 30×40).
    from sketch_translator import translate_sketch
    doc = {'unit': 'mm', 'pages': [{'size': {'width': 210, 'height': 297, 'unit': 'mm'},
                                    'margin': {}, 'elements': [
        {'id': 'l1', 'type': 'line', 'x': 10, 'y': 10, 'width': 30, 'height': 40,
         'points': [0, 0, 30, 40], 'stroke': '#111111', 'strokeWidth': 0.5, 'rotation': 0},
    ]}]}
    el = translate_sketch(doc)['templateJson']['pages'][0]['elements'][0]
    assert el['shape'] == 'rectangle'
    assert round(el['width'], 1) == 50.0          # hipotenusa 30-40-50
    assert el['height'] == 0.5                    # el grosor del trazo, no 40
    assert round(el['rotation'], 1) == 53.1       # atan2(40, 30)
    # Centrado en el punto medio del segmento (10+15, 10+20)
    assert round(el['x'] + el['width'] / 2, 1) == 25.0
    assert round(el['y'] + el['height'] / 2, 1) == 30.0


def test_traductor_alineacion_con_variables(mod):
    # Texto centrado CON variables → contentarea con <p style="text-align:center">
    # (antes la alineación se perdía y todo salía a la izquierda).
    from sketch_translator import translate_sketch
    doc = {'unit': 'mm', 'pages': [{'size': {'width': 210, 'height': 297, 'unit': 'mm'},
                                    'margin': {}, 'elements': [
        {'id': 't1', 'type': 'text', 'x': 10, 'y': 10, 'width': 100, 'height': 10,
         'text': 'Hola {{nombre}}', 'align': 'center', 'fontFamily': 'Inter',
         'fontSize': 12, 'color': '#111111', 'fontWeight': 400, 'lineHeight': 1.3},
    ]}]}
    tj = translate_sketch(doc)['templateJson']
    content = tj['contentAreas'][0]['content']
    assert 'text-align:center' in content and 'data-var="nombre"' in content


def test_traductor_estilos_por_celda(mod):
    # Los estilos por celda del editor (align/bold/color/background) viajan al motor.
    from sketch_translator import translate_sketch
    doc = {'unit': 'mm', 'pages': [{'size': {'width': 210, 'height': 297, 'unit': 'mm'},
                                    'margin': {}, 'elements': [
        {'id': 'tb1', 'type': 'table', 'x': 10, 'y': 10, 'width': 100, 'height': 40,
         'columns': [{'widthPercent': 50}, {'widthPercent': 50}],
         'rows': [
             [{'text': 'Total', 'bold': True, 'align': 'right'},
              {'text': '$100', 'color': '#dc2626', 'background': '#fef2f2'}],
         ],
         'hasHeader': False, 'hasFooter': False, 'borderWidth': 0.2,
         'borderColor': '#94a3b8', 'cellSpacing': 0, 'alternateRows': False,
         'alternateBackground': '#f9fafb', 'headerBackground': '#eee',
         'footerBackground': '#eee', 'rowFontSize': 9},
    ]}]}
    t = translate_sketch(doc)['templateJson']['pages'][0]['elements'][0]
    c1, c2 = t['body']['rows'][0]['cells']
    assert c1 == {'content': 'Total', 'bold': True, 'align': 'right'}
    assert c2 == {'content': '$100', 'color': '#dc2626', 'background': '#fef2f2'}


def test_traductor_span_con_font_family(mod):
    from sketch_translator import translate_sketch
    doc = {'unit': 'mm', 'pages': [{'size': {'width': 210, 'height': 297, 'unit': 'mm'},
                                    'margin': {}, 'elements': [
        {'id': 't1', 'type': 'text', 'x': 10, 'y': 10, 'width': 100, 'height': 10,
         'text': 'ab', 'align': 'left', 'fontFamily': 'Inter', 'fontSize': 12,
         'color': '#111111', 'fontWeight': 400, 'lineHeight': 1.3,
         'spans': [{'text': 'a'}, {'text': 'b', 'fontFamily': 'JetBrains Mono', 'fontSize': 10}]},
    ]}]}
    tj = translate_sketch(doc)['templateJson']
    content = tj['contentAreas'][0]['content']
    assert 'font-family:JetBrains Mono' in content


def test_font_manager_alias_de_familias(mod):
    # Familias del editor sin fuente propia → builtin equivalente (una monoespaciada
    # NO debe caer a Helvetica: cambiaría el layout respecto del lienzo).
    from pdf_engine.font_manager import FontManager
    fm = FontManager()
    assert fm.resolve('JetBrains Mono') == 'Courier'
    assert fm.resolve('JetBrains Mono', bold=True) == 'Courier-Bold'
    assert fm.resolve('Arial') == 'Helvetica'
    assert fm.resolve('Times New Roman', italic=True) == 'Times-Italic'
    assert fm.resolve('Courier New') == 'Courier'


def test_html_parser_alineacion_y_familia(mod):
    from pdf_engine.html_parser import parse_content
    paras = parse_content('<p style="text-align:center"><span style="font-family:courier">x</span></p>')
    paras = [p for p in paras if not p.is_empty()]
    assert paras[0].alignment == 'center'
    assert paras[0].runs[0].style.font_family == 'courier'


def test_render_con_rotacion_de_texto_y_tabla(mod):
    # Smoke: el despachador rota texto/tabla/QR sin reventar el render.
    doc = {'unit': 'mm', 'pages': [{'size': {'width': 210, 'height': 297, 'unit': 'mm'},
                                    'margin': {}, 'elements': [
        {'id': 't1', 'type': 'text', 'x': 30, 'y': 30, 'width': 80, 'height': 10,
         'text': 'Girado', 'align': 'left', 'fontFamily': 'Helvetica', 'fontSize': 12,
         'color': '#111111', 'fontWeight': 400, 'lineHeight': 1.3, 'rotation': 45},
        {'id': 'q1', 'type': 'qr', 'x': 150, 'y': 30, 'width': 30, 'height': 30,
         'barcodeType': 'QR', 'data': 'x', 'errorLevel': 'M', 'moduleSize': 4,
         'showText': False, 'rotation': 30},
        {'id': 'tb1', 'type': 'table', 'x': 20, 'y': 100, 'width': 120, 'height': 40,
         'columns': [{'widthPercent': 100, 'header': 'Col'}],
         'rows': [[{'text': 'dato'}]], 'hasHeader': False, 'hasFooter': False,
         'borderWidth': 0.2, 'borderColor': '#94a3b8', 'cellSpacing': 0,
         'alternateRows': False, 'alternateBackground': '#f9fafb',
         'headerBackground': '#eee', 'footerBackground': '#eee',
         'rowFontSize': 9, 'rotation': 15},
    ]}]}
    res = mod.lambda_handler(_ctx({'sketch': {'schema': 'pdfsketch@1', 'document': doc}}), None)
    assert _pdf_bytes(res)[:5] == b'%PDF-'
