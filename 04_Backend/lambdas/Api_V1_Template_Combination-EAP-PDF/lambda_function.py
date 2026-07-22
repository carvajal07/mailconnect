'''
Combinador de correspondencia para el canal EAP con PDF (envío real).

Es el consumidor de la cola `Template_Combination-EAP-PDF`, que Prepare-batch alimenta
cuando la campaña es EAP con `documentFormat=PDF`. Análogo a `Api_V1_Template_Combination`
(DOCX) pero, en vez de combinar un .docx con python-docx, RENDERIZA a PDF el HTML de la
plantilla que hizo el editor (PdfTemplatesSection).

Flujo por mensaje (build_ctx + part + data, ver Prepare-batch):
  1. Dedup por parte en `{tenant}_processDetail` (estado "Creando adjuntos") — evita
     adjuntos duplicados si SQS reentrega el mensaje.
  2. Baja la plantilla HTML del cliente desde S3 (documentPath del registro `document`
     de la campaña; el editor sube ese HTML con el prefijo attachment/).
  3. Por cada destinatario: reemplaza `{{campo}}` con su fila del CSV, renderiza el PDF
     y lo sube a `personalized/{campaignId}/{nombre}.pdf` (prefijo PRIVADO) del bucket del cliente.
  4. Re-emite el mensaje a `Email_Send-batch-raw-EAP` PRESERVANDO nit + samples +
     documentFormat (para que Send-EAP resuelva el bucket por NIT, adjunte el .pdf y
     cuente las muestras correctamente).

Requisito de despliegue [J]: cola `Template_Combination-EAP-PDF` + trigger; layer con
`xhtml2pdf` (+ reportlab, Pillow); permisos S3 (GetObject/PutObject), DynamoDB
(Scan document, Scan/PutItem {tenant}_processDetail) y SQS SendMessage.
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


def render_variables(html, mapping):
    """Reemplaza `{{ campo }}` (espacios opcionales) por su valor; deja las no resueltas."""
    if not html:
        return ''
    if not mapping:
        return html

    def repl(match):
        key = match.group(1).strip()
        return str(mapping[key]) if key in mapping else match.group(0)

    return re.sub(r'\{\{\s*([^{}]+?)\s*\}\}', repl, html)


def row_mapping(headers, row):
    """Construye {header: valor} desde una fila posicional del CSV."""
    mapping = {}
    for i, head in enumerate(headers or []):
        value = row[i] if row and i < len(row) else ''
        mapping[str(head)] = '' if value is None else str(value)
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

    # Dedup por parte (evita adjuntos duplicados ante reentrega SQS).
    existing = validate_process_detail(tenant, process_id, part)
    if existing.get('Items'):
        state = existing['Items'][0].get('stateProcess')
        print('La parte {} del proceso {} ya está en estado {} — se ignora (dedup)'.format(part, process_id, state))
        raise ValueError('La parte ya ha sido procesada')

    insert_process_detail(tenant, process_id, registers, part, formatted_date, 'Creando adjuntos')

    bucket_name = tenant_bucket(nit) if nit else '{}.document'.format(customer_name.lower())
    template_html = download_template_html(campaign_id, bucket_name)
    if not template_html:
        print('Sin plantilla PDF para la campaña {} — no se generan adjuntos'.format(campaign_id))
        return {'status': False, 'statusCode': 404, 'description': 'Plantilla PDF no encontrada'}

    for register in data:
        mapping = row_mapping(headers, register)
        rendered = render_variables(template_html, mapping)
        pdf_bytes = html_to_pdf(rendered, page_size)
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
