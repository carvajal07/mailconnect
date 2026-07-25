'''
Combinador de correspondencia para el canal EAP con PDF (envío real).

Es el consumidor de la cola `Template_Combination-EAP-PDF`, que Prepare-batch alimenta
cuando la campaña es EAP con `documentFormat=PDF`. Análogo a `Api_V1_Template_Combination`
(DOCX) pero RENDERIZA a PDF la plantilla que hizo el editor, en DOS formatos:
  - **HTML** (editor básico tipo Word, PdfTemplatesSection): reemplaza `{{campo}}` y
    renderiza con xhtml2pdf (como antes).
  - **JSON de lienzo** (Estudio PDF `sketchJson` / Diseñador `templateJson`): traduce con
    `sketch_translator` (o usa el templateJson directo) y renderiza con el motor
    `pdf_engine` (ReportLab) pasando la fila del CSV como `data` → las variables
    `{{campo}}` / dataField (`data-var`) se resuelven POR DESTINATARIO.
El formato se DETECTA por el contenido (si parsea a un dict JSON → lienzo; si no → HTML).

Flujo por mensaje (build_ctx + part + data, ver Prepare-batch):
  1. Dedup por parte en `{tenant}_processDetail` (estado "Creando adjuntos") — evita
     adjuntos duplicados si SQS reentrega el mensaje.
  2. Baja la plantilla del cliente desde S3 (documentPath del registro `document`
     de la campaña; el front sube el HTML o el JSON del lienzo con el prefijo attachment/).
  3. Por cada destinatario: sustituye sus datos, renderiza el PDF y lo sube a
     `personalized/{campaignId}/{nombre}.pdf` (prefijo PRIVADO) del bucket del cliente.
  4. Re-emite el mensaje a `Email_Send-batch-raw-EAP` PRESERVANDO nit + samples +
     documentFormat (para que Send-EAP resuelva el bucket por NIT, adjunte el .pdf y
     cuente las muestras correctamente).

Requisito de despliegue [J]: cola `Template_Combination-EAP-PDF` + trigger; layer con
`xhtml2pdf` **y** el motor (`reportlab`, `Pillow`, `qrcode`, `python-barcode`,
`beautifulsoup4`, `lxml`); el paquete incluye `pdf_engine/`, `sketch_translator.py` y
`fonts/` (vendorizados). Permisos S3 (GetObject/PutObject), DynamoDB (Scan document,
Scan/PutItem {tenant}_processDetail) y SQS SendMessage.
'''
import io
import json
import os
import re
import tempfile
import urllib.request
import uuid
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

from sketch_translator import translate_sketch

REGION = 'us-east-1'
URL_SQS_EAP = os.environ.get(
    'URL_SQS_EAP',
    'https://sqs.us-east-1.amazonaws.com/873837768806/Email_Send-batch-raw-EAP',
)
BUCKET_PREFIX = os.environ.get('BUCKET_PREFIX', 'mailconnect')
# Prefijo PRIVADO para los documentos personalizados por destinatario (traen datos
# personales). NO es público como attachment/ — Send-EAP los adjunta por get_object (IAM).
PERSONALIZED_PREFIX = 'personalized'
IMG_MAX_BYTES = int(os.environ.get('PDF_IMG_MAX_BYTES', str(8 * 1024 * 1024)))
IMG_TIMEOUT = int(os.environ.get('PDF_IMG_TIMEOUT', '10'))

dynamodb = boto3.resource('dynamodb', region_name=REGION)
sqs = boto3.client('sqs', region_name=REGION)
s3 = boto3.client('s3', region_name=REGION)
table_document = dynamodb.Table('document')


def tenant_key(nit):
    """Llave de tenant (NIT saneado) para {tenant}_processDetail. Idempotente."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def tenant_bucket(nit, doc_type=None):
    """Bucket ÚNICO del cliente por NIT: {prefix}-{nit} (doc_type es un prefijo de la key)."""
    clean = re.sub(r'[^a-z0-9]', '', str(nit or '').lower())
    return '{}-{}'.format(BUCKET_PREFIX, clean)


# ---------------------------------------------------------------------------
# Render HTML → PDF (copiado de Api_V1_Template_Render-pdf; sin imports compartidos
# entre lambdas, igual que tenant_key/tenant_bucket).
# ---------------------------------------------------------------------------
_PAGE_CSS = {
    'A4': '@page { size: A4; margin: 2cm; }',
    'CARTA': '@page { size: Letter; margin: 2cm; }',
    'LETTER': '@page { size: Letter; margin: 2cm; }',
}


def _norm_key(key):
    """Clave saneada para comparar encabezados/bindings: sin BOM, sin espacios y en
    minúsculas. El binding del editor sale de `databaseFile.columns` (front) y el
    encabezado del envío sale del CSV crudo que lee Prepare-batch → pueden diferir
    en BOM ('\ufeff' en la 1ª columna), espacios o mayúsculas."""
    return str(key).replace('\ufeff', '').strip().lower()


def render_variables(html, mapping):
    """Reemplaza `{{ campo }}` (espacios opcionales) por su valor; deja las no resueltas.
    Busca la clave EXACTA y, si no está, la versión saneada (BOM/espacios/mayúsculas)."""
    if not html:
        return ''
    if not mapping:
        return html
    norm = {}
    for k, v in mapping.items():
        norm.setdefault(_norm_key(k), v)

    def repl(match):
        key = match.group(1).strip()
        if key in mapping:
            return str(mapping[key])
        if _norm_key(key) in norm:
            return str(norm[_norm_key(key)])
        return match.group(0)

    return re.sub(r'\{\{\s*([^{}]+?)\s*\}\}', repl, html)


def row_mapping(headers, row):
    """Construye {header: valor} desde una fila posicional del CSV. El BOM del primer
    encabezado ('\ufeff', típico de CSV exportados de Excel) se quita de la clave."""
    mapping = {}
    for i, head in enumerate(headers or []):
        value = row[i] if row and i < len(row) else ''
        mapping[str(head).replace('\ufeff', '')] = '' if value is None else str(value)
    return mapping


_VAR_ATTR_RE = re.compile(r'data-var="([^"]+)"')


def augment_mapping_for_template(template_json, mapping):
    """Para el render con el MOTOR: por cada variable del template (data-var de los
    contentareas, QR/barcode por variable, dataSource de tablas) que no esté en el
    mapping con su clave exacta, crea un alias desde el encabezado equivalente
    (comparación saneada). Así `{{Nombre}}` resuelve aunque el CSV diga ` nombre`."""
    norm = {}
    for k in list(mapping.keys()):
        norm.setdefault(_norm_key(k), k)

    names = set()
    for area in (template_json.get('contentAreas') or []):
        for m in _VAR_ATTR_RE.finditer(area.get('content') or ''):
            names.add(m.group(1))
    for page in (template_json.get('pages') or []):
        for el in (page.get('elements') or []):
            if el.get('type') in ('qr', 'barcode') and el.get('valueSource') == 'variable':
                names.add(str(el.get('value') or ''))
            if el.get('type') == 'table' and el.get('dataSource'):
                names.add(str(el.get('dataSource')))

    for name in names:
        if not name or name in mapping:
            continue
        hit = norm.get(_norm_key(name))
        if hit is not None:
            mapping[name] = mapping[hit]
    return mapping


def wrap_html(inner, page_size='A4'):
    page = _PAGE_CSS.get(str(page_size or 'A4').upper(), _PAGE_CSS['A4'])
    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
        + page +
        ' body { font-family: Arial, Helvetica, sans-serif; font-size: 12pt; color: #111; line-height: 1.5; }'
        ' h1 { font-size: 22pt; } h2 { font-size: 18pt; } h3 { font-size: 15pt; }'
        ' img { max-width: 100%; }'
        ' table { border-collapse: collapse; width: 100%; }'
        ' td, th { border: 1px solid #cbd5e1; padding: 6px; }'
        ' blockquote { border-left: 3px solid #cbd5e1; margin: 8px 0; padding-left: 10px; color: #555; }'
        '</style></head><body>' + (inner or '') + '</body></html>'
    )


def _link_callback(uri, rel):
    try:
        if uri.startswith('http://') or uri.startswith('https://'):
            ext = os.path.splitext(uri.split('?')[0])[1] or '.img'
            fd, path = tempfile.mkstemp(suffix=ext, dir='/tmp')
            os.close(fd)
            req = urllib.request.Request(uri, headers={'User-Agent': 'mailconnect-pdf'})
            with urllib.request.urlopen(req, timeout=IMG_TIMEOUT) as resp:
                data = resp.read(IMG_MAX_BYTES + 1)
            if len(data) > IMG_MAX_BYTES:
                print('Imagen ignorada por tamaño (> {} bytes): {}'.format(IMG_MAX_BYTES, uri))
                return uri
            with open(path, 'wb') as f:
                f.write(data)
            return path
    except Exception as e:
        print('link_callback no pudo obtener {}: {}'.format(uri, e))
    return uri


def html_to_pdf(html, page_size='A4'):
    try:
        from xhtml2pdf import pisa
    except Exception as e:  # pragma: no cover - depende del layer en runtime
        raise RuntimeError(
            'Falta la librería de render de PDF (xhtml2pdf). Debe ir en un Lambda layer. Detalle: {}'.format(e)
        )
    source = wrap_html(html, page_size)
    out = io.BytesIO()
    result = pisa.CreatePDF(src=source, dest=out, encoding='utf-8', link_callback=_link_callback)
    if result.err:
        raise RuntimeError('No se pudo generar el PDF (errores de render: {})'.format(result.err))
    return out.getvalue()


# ---------------------------------------------------------------------------
# Render del LIENZO (Estudio/Diseñador) con el motor `pdf_engine` (ReportLab).
# ---------------------------------------------------------------------------
def parse_template_content(raw):
    """Detecta el formato de la plantilla descargada de S3.
    Devuelve ('html', str) para el editor básico, o ('template', templateJson_dict)
    para el lienzo (Estudio `sketchJson` o Diseñador `templateJson`)."""
    text = raw if isinstance(raw, str) else (raw or '')
    stripped = text.strip()
    if stripped.startswith('{'):
        try:
            obj = json.loads(stripped)
        except Exception:
            return 'html', text
        if isinstance(obj, dict):
            # sketchJson: envelope {schema:'pdfsketch@1', document} o DocumentModel con pages.
            if obj.get('schema') == 'pdfsketch@1' or (isinstance(obj.get('document'), dict)) \
                    or (isinstance(obj.get('pages'), list) and 'contentAreas' not in obj):
                try:
                    return 'template', translate_sketch(obj)['templateJson']
                except Exception as e:
                    print('No se pudo traducir el sketch; se intenta como templateJson: {}'.format(e))
            # templateJson del Diseñador (ya tiene el esquema del motor).
            if isinstance(obj.get('pages'), list):
                return 'template', obj
    return 'html', text


def render_engine_pdf(template_json, mapping):
    """Renderiza el templateJson con el motor pasando `mapping` (columna→valor) como
    data → las variables `data-var`/`{{campo}}` se resuelven por destinatario.
    El mapping se AUMENTA con alias saneados para que el binding del editor resuelva
    aunque el encabezado del CSV difiera en BOM/espacios/mayúsculas."""
    from pdf_engine.normalize import normalize
    from pdf_engine.page_renderer import render_pdf
    data = augment_mapping_for_template(template_json, dict(mapping or {}))
    ctx = normalize(template_json, data)
    return render_pdf(ctx)


# ---------------------------------------------------------------------------
# Dedup por parte + descarga de la plantilla (mismo patrón que el combinador DOCX).
# ---------------------------------------------------------------------------
def validate_process_detail(tenant, process_id, part):
    table = dynamodb.Table('{}_processDetail'.format(tenant))
    return table.scan(
        FilterExpression='processId = :v1 and part = :v2',
        ExpressionAttributeValues={':v1': process_id, ':v2': part},
        ProjectionExpression='stateProcess, processDetailId',
    )


def insert_process_detail(tenant, process_id, registers, part, date, state):
    table = dynamodb.Table('{}_processDetail'.format(tenant))
    table.put_item(Item={
        'processDetailId': str(uuid.uuid4()),
        'processId': process_id,
        'registers': registers,
        'part': part,
        'date': date,
        'stateProcess': state,
    })


def _claim_part(tenant, process_id, part, registers, date, stage='combine'):
    """Reclama ATÓMICAMENTE la etapa 'combine' de (processId, part). Clave DETERMINISTA
    `processId#part#combine` + escritura condicional `attribute_not_exists`: solo la PRIMERA
    entrega combina y re-emite (True); una redelivery de SQS pierde la condición (False → NO
    recombina ni re-emite → no duplica el envío aguas abajo). Reemplaza el scan+put con uuid
    aleatorio (no atómico). El sufijo de etapa evita chocar con el claim 'send' de Send-EAP,
    que comparte (processId, part) en la misma tabla. Fail-open si falta tenant/proceso."""
    if not tenant or not process_id or part is None:
        return True
    table = dynamodb.Table('{}_processDetail'.format(tenant))
    detail_id = '{}#{}#{}'.format(process_id, part, stage)
    try:
        table.put_item(
            Item={'processDetailId': detail_id, 'processId': process_id, 'part': part,
                  'registers': registers, 'date': date, 'stateProcess': 'Creando adjuntos', 'stage': stage},
            ConditionExpression='attribute_not_exists(processDetailId)')
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise


def download_template_html(campaign_id, bucket_name):
    """Baja el HTML de la plantilla PDF (documentPath del registro `document`)."""
    response = table_document.scan(
        FilterExpression='campaignId = :value',
        ExpressionAttributeValues={':value': campaign_id},
        ProjectionExpression='documentPath',
    )
    items = response.get('Items') or []
    if not items:
        print('El adjunto (plantilla PDF) no está registrado para la campaña {}'.format(campaign_id))
        return None
    attachment_path = items[0]['documentPath']
    obj = s3.get_object(Bucket=bucket_name, Key=attachment_path)
    raw = obj['Body'].read()
    if isinstance(raw, bytes):
        try:
            return raw.decode('utf-8')
        except UnicodeDecodeError:
            return raw.decode('latin-1')
    return raw


def send_sqs(url_sqs, message):
    try:
        sqs.send_message(QueueUrl=url_sqs, MessageBody=json.dumps(message))
    except Exception as e:
        print('No se pudo encolar a Send-EAP: {}'.format(e))


def lambda_handler(event, context):
    # Procesa todos los records del batch SQS (re-invoca uno a uno para reutilizar el flujo).
    records = event.get('Records') if isinstance(event, dict) else None
    if records and len(records) > 1:
        return [lambda_handler({'Records': [rec]}, context) for rec in records]

    now = datetime.utcnow()
    formatted_date = now.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

    try:
        body = event['Records'][0]['body']
        json_body = json.loads(body)
        customer_id = json_body['customerId']
        customer_name = json_body['customerName']
        nit = json_body.get('nit')
        tenant = tenant_key(nit)
        process_id = json_body['processId']
        campaign_id = json_body['campaignId']
        from_email = json_body['fromEmail']
        headers = json_body['headers']
        template_name = json_body['templateName']
        part = json_body['part']
        data = json_body['data']
        page_size = str(json_body.get('pageSize', 'A4') or 'A4')
        registers = len(data)
        print('EAP-PDF combiner · cliente={} proceso={} parte={} registros={}'.format(
            customer_name, process_id, part, registers))
    except Exception as e:
        print('Error leyendo el mensaje: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado en el servicio'}

    # IDEMPOTENCIA (etapa 'combine'): reclamo ATÓMICO de (processId, part). Reemplaza el scan+put
    # (no atómico): ante redelivery de SQS, solo la PRIMERA entrega combina y re-emite; la
    # duplicada se omite → no se generan adjuntos ni se re-emite el lote dos veces.
    if not _claim_part(tenant, process_id, part, registers, formatted_date, stage='combine'):
        print('La parte {} del proceso {} ya fue reclamada (combine); se omite (duplicado SQS).'.format(part, process_id))
        return {'status': True, 'statusCode': 200, 'description': 'Parte ya procesada (duplicado); se omite.'}

    bucket_name = tenant_bucket(nit) if nit else '{}.document'.format(customer_name.lower())
    template_raw = download_template_html(campaign_id, bucket_name)
    if not template_raw:
        print('Sin plantilla PDF para la campaña {} — no se generan adjuntos'.format(campaign_id))
        return {'status': False, 'statusCode': 404, 'description': 'Plantilla PDF no encontrada'}

    # Detecta el formato UNA vez (HTML del editor básico vs JSON del lienzo Estudio/Diseñador).
    kind, content = parse_template_content(template_raw)
    print('EAP-PDF combiner · formato de plantilla: {}'.format(kind))

    for register in data:
        mapping = row_mapping(headers, register)
        if kind == 'template':
            # Motor ReportLab: las variables (data-var) se resuelven con `mapping` (columna→valor).
            pdf_bytes = render_engine_pdf(content, mapping)
        else:
            pdf_bytes = html_to_pdf(render_variables(content, mapping), page_size)
        doc_name = '{}.pdf'.format(register[2] if len(register) > 2 else register[0])
        # PRIVADO: los personalizados por destinatario traen datos personales → van al prefijo
        # `personalized/` (NO público como attachment/). Send-EAP los adjunta por get_object (IAM).
        key = '{}/{}/{}'.format(PERSONALIZED_PREFIX, campaign_id, doc_name)
        s3.put_object(Bucket=bucket_name, Key=key, Body=pdf_bytes, ContentType='application/pdf')

    # Re-emite a Send-EAP PRESERVANDO nit + samples + documentFormat (a diferencia del
    # combinador DOCX, que los pierde) para que el envío resuelva el bucket por NIT,
    # adjunte el .pdf y cuente las muestras.
    out_body = {
        'customerId': customer_id,
        'customerName': customer_name,
        'nit': nit,
        'processId': process_id,
        'campaignId': campaign_id,
        'attachment': json_body.get('attachment', True),
        'fromEmail': from_email,
        'headers': headers,
        'templateName': template_name,
        'documentFormat': 'PDF',
        'samples': bool(json_body.get('samples')),
        'part': part,
        'data': data,
    }
    send_sqs(URL_SQS_EAP, out_body)
    return {'status': True, 'statusCode': 200, 'description': 'Adjuntos PDF generados', 'data': {'registers': registers}}
