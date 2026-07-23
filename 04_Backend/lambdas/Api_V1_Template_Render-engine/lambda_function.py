'''
Lambda MOTOR DE PDF ESTÁNDAR (síncrona) — renderiza el `templateJson` de los
diseñadores de nivel MEDIO (pdfsketch) y FULL (DocumentDesigner) del portal.

Es el motor vendorizado de workflow-doc-studio-production (`pdf_engine/`,
ReportLab): páginas en mm, elementos posicionados (texto, formas, imágenes,
tablas, QR/código de barras y content areas con variables
`<span class="var-tag" data-var="ruta.punto">`). El nivel BÁSICO (editor tipo
Word) sigue en `Api_V1_Template_Render-pdf` (xhtml2pdf) — tres editores, DOS
motores, UN contrato de render por plantilla posicionada.

Ruta: POST /Template/Render-engine   (integración no-proxy, envelope estándar)

Request (body) — una de las tres fuentes de plantilla:
  {
    "templateJson": {...},            # nivel FULL: el template del DocumentDesigner
    "sketch": {...},                  # nivel MEDIO: JSON de pdfsketch
                                      #   ({schema:'pdfsketch@1', document:{...}} o el DocumentModel directo)
    "messageTemplateId": "uuid",      # alternativo: plantilla guardada (channel=PDF,
                                      #   campos templateJson/sketchJson como string JSON)
    "data": { "nombre": "Ana", ... }, # variables del destinatario (rutas con punto soportadas)
    "store": false,                    # true = subir a S3; false = devolver base64
    "filename": "documento.pdf"
  }

Respuesta:
  - store=false → 200 { data: { pdfBase64, filename, contentType, warnings[] } }
  - store=true  → 200 { data: { path, url, filename, warnings[] } }
  - 400 datos inválidos · 403 sin identidad de cliente · 500 error de render

Requisito de despliegue [J]: layer con `reportlab` + `Pillow` (+ `qrcode`,
`python-barcode`, `beautifulsoup4`, `lxml`) para el runtime. Permisos:
DynamoDB GetItem sobre `messageTemplate`; S3 PutObject (bucket del cliente)
solo si se usa store=true.
'''
import base64
import json
import os
import re
import uuid
from datetime import datetime

import boto3
from botocore.client import Config

from sketch_translator import translate_sketch

REGION = 'us-east-1'
BUCKET_PREFIX = os.environ.get('BUCKET_PREFIX', 'mailconnect')

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


def _safe_filename(name, default='documento.pdf'):
    base = os.path.basename(str(name or '').replace('\\', '/')).strip()
    if not base:
        base = default
    if not base.lower().endswith('.pdf'):
        base = base + '.pdf'
    base = re.sub(r'[^A-Za-z0-9._-]', '_', base)
    return base[:128] or default


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


def _load_stored_template(template_id, customer_id):
    """Carga una plantilla guardada (channel=PDF) y devuelve (templateJson, sketch, error)."""
    try:
        item = _message_template_table.get_item(Key={'messageTemplateId': template_id}).get('Item')
    except Exception as e:
        print('No se pudo leer la plantilla {}: {}'.format(template_id, e))
        item = None
    if not item:
        return None, None, 'La plantilla no existe.'
    if customer_id and item.get('customerId') and item.get('customerId') != customer_id:
        return None, None, 'La plantilla no pertenece a tu cuenta.'

    def _parse(field):
        raw = item.get(field)
        if isinstance(raw, dict):
            return raw
        if isinstance(raw, str) and raw.strip():
            try:
                parsed = json.loads(raw)
                return parsed if isinstance(parsed, dict) else None
            except Exception:
                return None
        return None

    template_json = _parse('templateJson')
    sketch = _parse('sketchJson')
    if not template_json and not sketch:
        return None, None, 'La plantilla no tiene templateJson ni sketchJson (¿es del editor básico HTML? Usa /Template/Render-pdf).'
    return template_json, sketch, None


def _resolve_template(payload, customer_id):
    """Resuelve la plantilla a renderizar. Devuelve (templateJson, warnings, error)."""
    template_json = payload.get('templateJson')
    sketch = payload.get('sketch') or payload.get('sketchJson')
    if not template_json and not sketch:
        template_id = str(payload.get('messageTemplateId', '')).strip()
        if template_id:
            template_json, sketch, err = _load_stored_template(template_id, customer_id)
            if err:
                return None, [], err
    if isinstance(template_json, dict):
        return template_json, [], None
    if isinstance(sketch, dict):
        try:
            result = translate_sketch(sketch)
        except ValueError as e:
            return None, [], str(e)
        return result['templateJson'], result.get('warnings', []), None
    return None, [], 'Falta la plantilla (templateJson, sketch o messageTemplateId).'


def lambda_handler(event, context):
    payload = _get_payload(event)
    auth = _authorizer(event)
    nit = auth.get('nit') or auth.get('companyTin')
    customer = auth.get('customer') or ''
    customer_id = auth.get('customerId')
    if not (nit or customer):
        return {'status': False, 'statusCode': 403,
                'description': 'Sesión sin identidad de cliente.', 'data': {}}

    template_json, warnings, err = _resolve_template(payload, customer_id)
    if err:
        return {'status': False, 'statusCode': 400, 'description': err, 'data': {}}

    data = payload.get('data') or payload.get('variables') or {}
    if not isinstance(data, dict):
        data = {}
    store = bool(payload.get('store'))
    filename = _safe_filename(payload.get('filename'))

    try:
        # Import diferido: reportlab vive en el layer; si falta, respondemos 500
        # con un mensaje accionable en vez de reventar en el import del módulo.
        from pdf_engine.normalize import normalize
        from pdf_engine.page_renderer import render_pdf
    except Exception as e:
        print('Faltan librerías del motor (layer): {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Falta la librería de render (reportlab). Debe ir en un Lambda layer.',
                'data': {}}

    try:
        ctx = normalize(template_json, data)
        pdf_bytes = render_pdf(ctx)
    except Exception as e:
        print('Error de render del motor: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'No se pudo generar el PDF: {}'.format(e), 'data': {}}

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
                'data': {'path': key, 'url': url, 'filename': filename, 'warnings': warnings}}

    return {
        'status': True, 'statusCode': 200, 'description': 'PDF generado correctamente',
        'data': {
            'pdfBase64': base64.b64encode(pdf_bytes).decode('ascii'),
            'filename': filename,
            'contentType': 'application/pdf',
            'warnings': warnings,
        },
    }
