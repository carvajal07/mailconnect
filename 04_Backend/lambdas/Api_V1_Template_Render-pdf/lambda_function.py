'''
Lambda GENERADORA DE PDF (síncrona) — "habla" con el editor de Plantillas PDF.

El editor de documento tipo Word (frontend PdfTemplatesSection) produce HTML con
variables `{{campo}}`. Esta lambda recibe ese HTML (+ valores de muestra) y devuelve
el PDF RENDERIZADO, ya sea:
  - en base64 (para previsualizar/descargar desde el editor), o
  - subido a S3 (bucket único del cliente, prefijo público `attachment/`) devolviendo
    su ruta + URL pública.

Es la MISMA lógica de render (html_to_pdf) que usa el combinador del envío real
(Api_V1_Template_Combination-EAP-PDF); aquí se expone de forma síncrona para el
editor. Como en el resto del proyecto NO hay imports compartidos entre lambdas, el
render se copia en ambas (igual que tenant_key/tenant_bucket).

Ruta: POST /Template/Render-pdf   (integración no-proxy, envelope estándar)

Request (body):
  {
    "html": "<h1>...{{nombre}}...</h1>",   # HTML del editor (obligatorio si no hay messageTemplateId)
    "messageTemplateId": "uuid",            # alternativo: plantilla PDF ya guardada (channel=PDF)
    "variables": { "nombre": "Ana", ... },  # valores para reemplazar {{campo}} (opcional; muestra)
    "pageSize": "A4" | "Carta",             # tamaño de hoja (default A4)
    "store": false,                          # true = subir a S3; false = devolver base64
    "filename": "plantilla.pdf"             # nombre del archivo (saneado)
  }

Respuesta:
  - store=false → 200 { data: { pdfBase64, filename, contentType:'application/pdf' } }
  - store=true  → 200 { data: { path, url, filename } }
  - 400 datos inválidos · 403 sin identidad de cliente · 500 error de render

Requisito de despliegue [J]: layer con `xhtml2pdf` (+ reportlab, Pillow) para el runtime
de la función. Permisos S3 (PutItem del objeto) solo si se usa store=true.
'''
import base64
import io
import json
import os
import re
import tempfile
import urllib.request
import uuid
from datetime import datetime

import boto3
from botocore.client import Config

REGION = 'us-east-1'
BUCKET_PREFIX = os.environ.get('BUCKET_PREFIX', 'mailconnect')
# Tope defensivo para descargar imágenes remotas del template (evita adjuntos gigantes/colgar el render).
IMG_MAX_BYTES = int(os.environ.get('PDF_IMG_MAX_BYTES', str(8 * 1024 * 1024)))
IMG_TIMEOUT = int(os.environ.get('PDF_IMG_TIMEOUT', '10'))

s3 = boto3.client('s3', region_name=REGION, config=Config(signature_version='s3v4'))
dynamodb = boto3.resource('dynamodb', region_name=REGION)
_message_template_table = dynamodb.Table('messageTemplate')


def tenant_bucket(nit, doc_type=None):
    """Bucket ÚNICO del cliente por NIT: {prefix}-{nit} (doc_type es un prefijo de la key)."""
    clean = re.sub(r'[^a-z0-9]', '', str(nit or '').lower())
    return '{}-{}'.format(BUCKET_PREFIX, clean)


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def _get_payload(event):
    """Aplana el body (no-proxy inyecta un dict; proxy un string JSON) preservando el
    requestContext para leer la identidad del Authorizer. Si ya viene plano, lo usa tal cual."""
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        rc = event.get('requestContext')
        merged = dict(event['body'])
        if rc and 'requestContext' not in merged:
            merged['requestContext'] = rc
        return merged
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            parsed = json.loads(event['body'])
            if isinstance(parsed, dict):
                if event.get('requestContext') and 'requestContext' not in parsed:
                    parsed['requestContext'] = event['requestContext']
                return parsed
        except Exception:
            pass
    return event if isinstance(event, dict) else {}


def _safe_filename(name, default='plantilla.pdf'):
    base = os.path.basename(str(name or '').replace('\\', '/')).strip()
    if not base:
        base = default
    if not base.lower().endswith('.pdf'):
        base = base + '.pdf'
    # Solo caracteres seguros para una key S3 / Content-Disposition.
    base = re.sub(r'[^A-Za-z0-9._-]', '_', base)
    return base[:128] or default


# ---------------------------------------------------------------------------
# Render HTML → PDF (idéntico al del combinador del envío real).
# ---------------------------------------------------------------------------
_PAGE_CSS = {
    'A4': '@page { size: A4; margin: 2cm; }',
    'CARTA': '@page { size: Letter; margin: 2cm; }',
    'LETTER': '@page { size: Letter; margin: 2cm; }',
}


def render_variables(html, mapping):
    """Reemplaza `{{ campo }}` (espacios opcionales) por su valor. Las variables sin
    valor se dejan tal cual (para que en la vista previa se vea qué falta por llenar)."""
    if not html:
        return ''
    if not mapping:
        return html

    def repl(match):
        key = match.group(1).strip()
        return str(mapping[key]) if key in mapping else match.group(0)

    return re.sub(r'\{\{\s*([^{}]+?)\s*\}\}', repl, html)


def row_mapping(headers, row):
    """Construye {header: valor} a partir de una fila posicional del CSV."""
    mapping = {}
    for i, head in enumerate(headers or []):
        value = row[i] if row and i < len(row) else ''
        mapping[str(head)] = '' if value is None else str(value)
    return mapping


def wrap_html(inner, page_size='A4'):
    """Envuelve el HTML del editor en un documento con marco de página (tamaño + CSS base)."""
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
    """Resuelve el `src` de las imágenes: descarga http(s) a /tmp para que xhtml2pdf las
    embeba. data: URIs las maneja pisa directamente. Con tope de tamaño y timeout."""
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
    """Renderiza el HTML a PDF (bytes). Lanza RuntimeError si falta la librería o hay error."""
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


def _ensure_bucket(name):
    try:
        s3.head_bucket(Bucket=name)
        return
    except Exception:
        pass
    try:
        s3.create_bucket(Bucket=name)
    except Exception as e:
        print('No se pudo asegurar el bucket {}: {}'.format(name, e))


def _resolve_html(payload, customer_id):
    """HTML a renderizar: inline `html`, o el de una plantilla PDF guardada (channel=PDF)."""
    html = payload.get('html')
    if isinstance(html, str) and html.strip():
        return html, None
    template_id = str(payload.get('messageTemplateId', '')).strip()
    if template_id:
        try:
            item = _message_template_table.get_item(Key={'messageTemplateId': template_id}).get('Item')
        except Exception as e:
            print('No se pudo leer la plantilla {}: {}'.format(template_id, e))
            item = None
        if not item:
            return None, 'La plantilla PDF no existe.'
        if customer_id and item.get('customerId') and item.get('customerId') != customer_id:
            return None, 'La plantilla no pertenece a tu cuenta.'
        stored = item.get('html') or item.get('body') or ''
        if not stored.strip():
            return None, 'La plantilla PDF no tiene contenido.'
        return stored, None
    return None, 'Falta el HTML de la plantilla (html o messageTemplateId).'


def lambda_handler(event, context):
    payload = _get_payload(event)
    auth = _authorizer(event)
    nit = auth.get('nit') or auth.get('companyTin')
    customer = auth.get('customer') or ''
    customer_id = auth.get('customerId')
    if not (nit or customer):
        return {'status': False, 'statusCode': 403,
                'description': 'Sesión sin identidad de cliente.', 'data': {}}

    html, err = _resolve_html(payload, customer_id)
    if err:
        return {'status': False, 'statusCode': 400, 'description': err, 'data': {}}

    variables = payload.get('variables') or payload.get('data') or {}
    if not isinstance(variables, dict):
        variables = {}
    page_size = str(payload.get('pageSize', 'A4') or 'A4')
    store = bool(payload.get('store'))
    filename = _safe_filename(payload.get('filename'))

    rendered_html = render_variables(html, variables)
    try:
        pdf_bytes = html_to_pdf(rendered_html, page_size)
    except RuntimeError as e:
        print('Error de render: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': str(e), 'data': {}}
    except Exception as e:  # pragma: no cover - defensivo
        print('Error no controlado de render: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al generar el PDF.', 'data': {}}

    if store:
        if not nit:
            return {'status': False, 'statusCode': 400,
                    'description': 'Se requiere el NIT del cliente para guardar en S3.', 'data': {}}
        bucket = tenant_bucket(nit)
        _ensure_bucket(bucket)
        date = datetime.utcnow().strftime('%Y-%m-%d')
        key = 'attachment/pdf-preview/{}/{}-{}'.format(date, str(uuid.uuid4())[:8], filename)
        try:
            s3.put_object(Bucket=bucket, Key=key, Body=pdf_bytes, ContentType='application/pdf')
        except Exception as e:
            print('No se pudo subir el PDF a S3: {}'.format(e))
            return {'status': False, 'statusCode': 500,
                    'description': 'No se pudo subir el PDF a S3.', 'data': {}}
        url = 'https://s3.{}.amazonaws.com/{}/{}'.format(REGION, bucket, key)
        return {'status': True, 'statusCode': 200, 'description': 'PDF generado correctamente',
                'data': {'path': key, 'url': url, 'filename': filename}}

    return {
        'status': True, 'statusCode': 200, 'description': 'PDF generado correctamente',
        'data': {
            'pdfBase64': base64.b64encode(pdf_bytes).decode('ascii'),
            'filename': filename,
            'contentType': 'application/pdf',
        },
    }
