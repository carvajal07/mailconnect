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




def _pdf_text(pdf_bytes):
    """Texto de los content streams del PDF (Flate directo o ASCII85+Flate de
    ReportLab). Permite verificar que las VARIABLES quedaron resueltas DENTRO del
    PDF (los smoke de %PDF- no detectaban un render sin contenido)."""
    import base64 as _b64
    import re as _re
    import zlib as _zlib
    out = b''
    for m in _re.finditer(rb'stream\r?\n(.*?)endstream', pdf_bytes, _re.S):
        data = m.group(1).strip()
        try:
            out += _zlib.decompress(data)
            continue
        except Exception:
            pass
        try:
            out += _zlib.decompress(_b64.a85decode(data, adobe=True))
        except Exception:
            out += data
    return out

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
    # Las variables quedaron RESUELTAS dentro del PDF (dataField y {{ciudad}}).
    contenido = _pdf_text(pdf)
    assert b'Ana' in contenido and 'Bogotá'.encode('utf-8') not in b'' and b'Bogot' in contenido
    assert b'{{' not in contenido
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


def test_variables_resuelven_con_bom_y_mayusculas_distintas(combiner):
    # ROBUSTEZ del envío real: el binding del editor ('Nombre') sale de las columnas
    # registradas por el front, pero los headers del mensaje salen del CSV CRUDO que
    # lee Prepare-batch → pueden traer BOM (1ª columna) o distinto case/espacios.
    # El combinador debe resolver igual (alias saneados).
    mod, _, _, s3 = combiner
    sketch = {'schema': 'pdfsketch@1', 'document': {
        'unit': 'mm',
        'pages': [{'size': {'width': 210, 'height': 297, 'unit': 'mm'}, 'margin': {}, 'elements': [
            {'id': 'df', 'type': 'dataField', 'x': 20, 'y': 20, 'width': 100, 'height': 10,
             'binding': 'Nombre', 'fallback': '', 'fontFamily': 'Helvetica', 'fontSize': 14, 'color': '#111111'},
            {'id': 'df2', 'type': 'dataField', 'x': 20, 'y': 40, 'width': 100, 'height': 10,
             'binding': 'identificacion', 'fallback': '', 'fontFamily': 'Helvetica', 'fontSize': 12, 'color': '#111111'},
        ]}],
    }}
    key = 'attachment/2026-07-22/estudio-bom.json'
    s3.put_object(Bucket=BUCKET, Key=key, Body=json.dumps(sketch).encode())
    boto3.resource('dynamodb', region_name='us-east-1').Table('document').put_item(
        Item={'documentId': 'd3', 'campaignId': 'camp-bom', 'documentPath': key})

    # Headers del CSV crudo: BOM en la 1ª columna + case distinto (' nombre ').
    body = {
        'customerId': CID, 'customerName': CUST, 'nit': NIT, 'processId': PROC,
        'campaignId': 'camp-bom', 'attachment': True, 'fromEmail': 'no-reply@x.com',
        'headers': ['﻿Identificacion', 'correo', ' nombre '], 'templateName': 'tmpl',
        'part': 9, 'data': [['123', 'a@x.com', 'Ana']], 'samples': False,
    }
    res = mod.lambda_handler({'Records': [{'body': json.dumps(body)}]}, None)
    assert res['statusCode'] == 200
    pdf = s3.get_object(Bucket=BUCKET, Key='personalized/camp-bom/Ana.pdf')['Body'].read()
    assert pdf[:5] == b'%PDF-'
    # Pese al BOM y al case distinto, ambas variables quedaron resueltas.
    contenido = _pdf_text(pdf)
    assert b'Ana' in contenido and b'123' in contenido and b'{{' not in contenido


def test_augment_mapping_alias_saneados(combiner):
    mod, _, _, _ = combiner
    tj = {'contentAreas': [{'content': '<p><span class="var-tag" data-var="Nombre">{{Nombre}}</span></p>'}],
          'pages': [{'elements': [{'type': 'qr', 'valueSource': 'variable', 'value': 'Correo'}]}]}
    mapping = mod.augment_mapping_for_template(tj, {' nombre ': 'Ana', '﻿Correo': 'a@x.com'})
    assert mapping['Nombre'] == 'Ana'          # binding ≠ header solo por espacios/case
    assert mapping['Correo'] == 'a@x.com'      # BOM en el header

    # La clave EXACTA siempre gana sobre el alias.
    m2 = mod.augment_mapping_for_template(tj, {'Nombre': 'Exacta', 'nombre': 'Alias'})
    assert m2['Nombre'] == 'Exacta'


def test_render_variables_html_tolerante_a_case(combiner):
    mod, _, _, _ = combiner
    out = mod.render_variables('<p>Hola {{Nombre}} ({{ciudad}})</p>', {' nombre ': 'Ana', 'Ciudad': 'Bogotá'})
    assert out == '<p>Hola Ana (Bogotá)</p>'


# ── Celdas con JSON embebido (arrays de las bases .json) ──────────────────────

def test_row_mapping_parsea_celdas_json(combiner):
    mod, _, _, _ = combiner
    m = mod.row_mapping(
        ['id', 'correo', 'nombre', 'movimientos'],
        ['1', 'a@x.com', 'Ana', '[{"Detalle": "Compra", "Valor": "5000"}]'])
    # La celda JSON se parsea a LISTA (alimenta el dataSource de las tablas).
    assert isinstance(m['movimientos'], list)
    assert m['movimientos'][0]['Detalle'] == 'Compra'
    # Las celdas normales siguen siendo texto; un JSON roto queda como texto literal.
    assert m['nombre'] == 'Ana'
    m2 = mod.row_mapping(['x'], ['[esto no es json'])
    assert m2['x'] == '[esto no es json'
    # En el camino HTML, una variable-lista se sustituye como JSON (no repr de Python).
    html = mod.render_variables('<p>{{movimientos}}</p>', m)
    assert '"Detalle"' in html and "'Detalle'" not in html


def test_tabla_repeat_por_destinatario_con_celda_json_y_paginacion(combiner):
    # Flujo COMPLETO de las bases .json: la columna `movimientos` de la fila trae un
    # ARRAY como JSON embebido → el combinador lo parsea, la tabla `repeatBy` del
    # Estudio pinta una fila por ítem y, como no caben en el alto de la tabla, el
    # PDF PAGINA a hojas nuevas (nada se pierde ni se encoge).
    mod, _, _, s3 = combiner
    sketch = {'schema': 'pdfsketch@1', 'document': {
        'unit': 'mm',
        'pages': [{'size': {'width': 210, 'height': 297, 'unit': 'mm'}, 'margin': {}, 'elements': [
            {'id': 'df', 'type': 'dataField', 'x': 20, 'y': 12, 'width': 100, 'height': 8,
             'binding': 'nombre', 'fallback': '', 'fontFamily': 'Helvetica', 'fontSize': 12, 'color': '#111111'},
            {'id': 'tb', 'type': 'table', 'x': 15, 'y': 30, 'width': 180, 'height': 40,
             'rotation': 0, 'visible': True, 'locked': False, 'zIndex': 2,
             'columns': [{'widthPercent': 60, 'minWidth': 10, 'header': 'Detalle'},
                         {'widthPercent': 40, 'minWidth': 10, 'header': 'Valor'}],
             'rows': [[{'text': 'Detalle'}, {'text': 'Valor'}]],
             'hasHeader': True, 'hasFooter': False, 'headerBackground': '#f1f5f9',
             'borderWidth': 0.3, 'borderColor': '#94a3b8', 'rowFontSize': 9,
             'repeatBy': 'movimientos'},
        ]}],
    }}
    key = 'attachment/2026-07-22/estudio-extracto.json'
    s3.put_object(Bucket=BUCKET, Key=key, Body=json.dumps(sketch).encode())
    boto3.resource('dynamodb', region_name='us-east-1').Table('document').put_item(
        Item={'documentId': 'd4', 'campaignId': 'camp-extracto', 'documentPath': key})

    movimientos = [{'Detalle': 'Movimiento %02d' % i, 'Valor': '$ %d' % (i * 100)}
                   for i in range(1, 31)]
    body = {
        'customerId': CID, 'customerName': CUST, 'nit': NIT, 'processId': PROC,
        'campaignId': 'camp-extracto', 'attachment': True, 'fromEmail': 'no-reply@x.com',
        'headers': ['id', 'correo', 'nombre', 'movimientos'], 'templateName': 'tmpl',
        'part': 11, 'data': [['1', 'a@x.com', 'Ana', json.dumps(movimientos)]],
        'samples': False,
    }
    res = mod.lambda_handler({'Records': [{'body': json.dumps(body)}]}, None)
    assert res['statusCode'] == 200
    pdf = s3.get_object(Bucket=BUCKET, Key='personalized/camp-extracto/Ana.pdf')['Body'].read()
    assert pdf[:5] == b'%PDF-'
    # Los 30 movimientos NO caben en 40 mm → el PDF trae VARIAS páginas.
    import re as _re
    n_pages = len(_re.findall(rb'/Type\s*/Page(?!s)', pdf))
    assert n_pages >= 2
    contenido = _pdf_text(pdf)
    assert b'Ana' in contenido
    assert b'Movimiento 01' in contenido
    assert b'Movimiento 30' in contenido  # la última fila fluyó a otra hoja
    assert b'{{' not in contenido
