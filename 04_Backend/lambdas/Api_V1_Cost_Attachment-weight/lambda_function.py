'''
Lambda CLIENTE: PESO REAL del adjunto de una campaña (insumo del estimador de costo).

Problema que resuelve: el estimador (`/Cost/Estimate`) recibe `attachmentSizeMB` DECLARADO
a mano por el usuario. Para EAU el peso es un dato que ya existe (el archivo está en S3) y
para EAP el adjunto ni siquiera existe todavía: se GENERA por destinatario al enviar, así
que nadie puede saber cuánto pesa sin producir uno. Declararlo a ojo hace que el recargo
por MB se cobre sobre un número inventado.

Ruta: POST /Cost/Attachment-weight  (integración no-proxy, envelope estándar)
Request:  { campaignId, samples? }   (el tenant sale del context del Authorizer)
Respuesta: 200 { data: { mode, format, exact, samples, avgBytes, minBytes, maxBytes,
                         marginPct, sizeMB, note } }
           · 400 falta campaignId / la campaña no tiene adjunto
           · 403 sin sesión o campaña de otro cliente · 404 campaña/base no encontrada
           · 502 no se pudo medir (S3 / render)

Cómo mide, según el tipo de adjunto:

  • EAU (archivo ÚNICO, ya subido)  → `head_object` sobre el documento en S3. Es el archivo
    EXACTO que se adjunta a todos los correos, así que no hay nada que estimar:
    `exact=true`, `samples=1` y NO se aplica margen.

  • EAP + PDF (personalizado por destinatario) → se toman hasta `samples` filas REALES de
    la base de la campaña, se renderiza un PDF por fila con el MISMO motor del envío
    (invocando `Api_V1_Template_Render-engine` para plantillas del Estudio/Diseñador o
    `Api_V1_Template_Render-pdf` para el HTML del editor básico) y se promedia el peso.
    Como un PDF pesa distinto según los datos de cada destinatario (una tabla de 3
    movimientos vs una de 300), se promedia sobre varias muestras y se aplica un margen
    de seguridad (`ATTACHMENT_WEIGHT_MARGIN`, 20% por defecto) para que el estimado quede
    por ENCIMA y el cobro nunca se quede corto.

  • EAP + DOCX → el combinador sustituye variables sobre el .docx plantilla; el documento
    resultante pesa prácticamente lo mismo que la plantilla (cambia el texto, no los
    recursos incrustados). Se mide la plantilla con `head_object` + margen, y se marca
    `exact=false` con la nota correspondiente.

Env:
  ATTACHMENT_WEIGHT_MARGIN   margen de seguridad sobre el promedio (default 0.20 = +20%)
  ATTACHMENT_WEIGHT_SAMPLES  muestras por defecto (default 10)
  ATTACHMENT_WEIGHT_MAX_SAMPLES  tope duro de muestras (default 10)
  RENDER_ENGINE_FUNCTION / RENDER_PDF_FUNCTION  nombres de las lambdas de render

⚠️ [J] despliegue: lambda + ruta /Cost/Attachment-weight (authorizer + CORS + mapping
template con customerId/customer/nit); IAM `dynamodb:GetItem campaign` + `Scan document` +
`Scan databaseFile`, `s3:GetObject/HeadObject` (bucket del cliente) y
`lambda:InvokeFunction` sobre Api_V1_Template_Render-engine / Api_V1_Template_Render-pdf.
NO necesita el layer de reportlab: no renderiza, delega en las lambdas que ya lo tienen.
'''
import base64
import csv
import io
import json
import os
import re
import boto3
from botocore.exceptions import ClientError

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
s3 = boto3.client('s3', region_name=REGION)
lambda_client = boto3.client('lambda', region_name=REGION)

table_campaign = dynamodb.Table('campaign')
table_document = dynamodb.Table('document')
table_database = dynamodb.Table('databaseFile')

BUCKET_PREFIX = os.environ.get('BUCKET_PREFIX', 'mailconnect')
MARGIN = float(os.environ.get('ATTACHMENT_WEIGHT_MARGIN', '0.20'))
DEFAULT_SAMPLES = int(os.environ.get('ATTACHMENT_WEIGHT_SAMPLES', '10'))
MAX_SAMPLES = int(os.environ.get('ATTACHMENT_WEIGHT_MAX_SAMPLES', '10'))
RENDER_ENGINE_FN = os.environ.get('RENDER_ENGINE_FUNCTION', 'Api_V1_Template_Render-engine')
RENDER_PDF_FN = os.environ.get('RENDER_PDF_FUNCTION', 'Api_V1_Template_Render-pdf')

BYTES_PER_MB = 1024 * 1024
MAX_CSV_BYTES = 2 * 1024 * 1024   # solo hace falta el encabezado + las primeras filas


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            parsed = json.loads(event['body'])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return event if isinstance(event, dict) else {}


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def tenant_key(nit):
    """Llave del tenant: el NIT saneado. Copiada (convención del repo: sin imports
    compartidos entre lambdas). Idempotente."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def tenant_bucket(nit):
    """Bucket ÚNICO del cliente; los tipos van como PREFIJO de la key."""
    return '{}-{}'.format(BUCKET_PREFIX, tenant_key(nit))


def _resp(code, description, data=None):
    return {'status': 200 <= code < 300, 'statusCode': code,
            'description': description, 'data': data or {}}


# ── Lectura de la base (muestras REALES) ─────────────────────────────────────

def _sniff_delimiter(header_line):
    """Mismo criterio que Prepare-batch: el cliente puede subir la base con ; , tab o |."""
    best, best_count = ';', -1
    for cand in (';', ',', '\t', '|'):
        count = header_line.count(cand)
        if count > best_count:
            best, best_count = cand, count
    return best


def _sample_rows(bucket, data_path, limit):
    """Devuelve (headers, [filas]) leyendo SOLO el principio del CSV (Range), que es todo
    lo que hace falta para unas pocas muestras aunque la base tenga millones de filas."""
    try:
        obj = s3.get_object(Bucket=bucket, Key=data_path,
                            Range='bytes=0-{}'.format(MAX_CSV_BYTES - 1))
    except ClientError:
        # Sin soporte de Range (o archivo más chico): se baja completo.
        obj = s3.get_object(Bucket=bucket, Key=data_path)
    raw = obj['Body'].read()
    if isinstance(raw, bytes):
        try:
            text = raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            text = raw.decode('latin-1')
    else:
        text = raw

    lines = text.splitlines()
    if not lines:
        return [], []
    delimiter = _sniff_delimiter(lines[0])
    reader = csv.reader(io.StringIO('\n'.join(lines)), delimiter=delimiter)
    rows = list(reader)
    if not rows:
        return [], []
    headers = [str(h).replace('﻿', '').strip() for h in rows[0]]
    # La ÚLTIMA línea del rango puede venir cortada a la mitad → se descarta.
    body = rows[1:-1] if len(rows) > 2 and len(text.encode('utf-8')) >= MAX_CSV_BYTES else rows[1:]
    return headers, [r for r in body if any(str(c).strip() for c in r)][:limit]


def _row_mapping(headers, row):
    """{encabezado: valor} desde una fila posicional; las celdas con JSON embebido
    (bases .json / multiregistro) se parsean para que alimenten tablas con repetición —
    mismo criterio que el combinador, para que el peso medido sea el peso real."""
    mapping = {}
    for i, head in enumerate(headers or []):
        value = row[i] if row and i < len(row) else ''
        value = '' if value is None else str(value)
        stripped = value.strip()
        if stripped[:1] in ('[', '{'):
            try:
                value = json.loads(stripped)
            except Exception:
                pass
        mapping[str(head).replace('﻿', '')] = value
    return mapping


# ── Render delegado (sin layer de PDF en esta lambda) ────────────────────────

def _parse_template_content(raw):
    """Detecta el formato del documento de la campaña: HTML del editor básico, o JSON del
    Estudio (`sketch`) / Diseñador (`templateJson`). Mismo criterio que el combinador."""
    text = raw.strip() if isinstance(raw, str) else ''
    if not text.startswith('{'):
        return 'html', text
    try:
        parsed = json.loads(text)
    except Exception:
        return 'html', text
    if not isinstance(parsed, dict):
        return 'html', text
    if parsed.get('schema') == 'pdfsketch@1' or 'document' in parsed:
        return 'sketch', parsed
    return 'templateJson', parsed


def _invoke_render(function_name, payload, auth):
    """Invoca una lambda de render y devuelve los BYTES del PDF (o None).

    Se reenvía el `requestContext.authorizer` del llamante para que la lambda de render
    resuelva el mismo tenant; se pide `store=false` para recibir el PDF en base64 y NO
    dejar basura en S3 por cada medición.
    """
    event = dict(payload)
    event['store'] = False
    event['requestContext'] = {'authorizer': auth}
    try:
        resp = lambda_client.invoke(FunctionName=function_name,
                                    InvocationType='RequestResponse',
                                    Payload=json.dumps(event).encode('utf-8'))
        body = json.loads(resp['Payload'].read())
    except Exception as e:
        print('No se pudo invocar {}: {}'.format(function_name, e))
        return None
    # Las lambdas de render son no-proxy: devuelven el envelope directo.
    if isinstance(body, dict) and isinstance(body.get('body'), str):
        try:
            body = json.loads(body['body'])
        except Exception:
            pass
    if not isinstance(body, dict) or not body.get('status'):
        print('Render {} respondió: {}'.format(function_name, (body or {}).get('description')))
        return None
    b64 = ((body.get('data') or {}).get('pdfBase64')) or ''
    if not b64:
        return None
    try:
        return base64.b64decode(b64)
    except Exception:
        return None


def _render_sizes(kind, content, headers, rows, auth):
    """Renderiza un PDF por fila de muestra y devuelve la lista de tamaños en bytes."""
    sizes = []
    for row in rows:
        mapping = _row_mapping(headers, row)
        if kind == 'html':
            data = _invoke_render(RENDER_PDF_FN, {'html': content, 'variables': mapping}, auth)
        elif kind == 'sketch':
            data = _invoke_render(RENDER_ENGINE_FN, {'sketch': content, 'data': mapping}, auth)
        else:
            data = _invoke_render(RENDER_ENGINE_FN, {'templateJson': content, 'data': mapping}, auth)
        if data:
            sizes.append(len(data))
    return sizes


# ── Resolución de la campaña y su adjunto ────────────────────────────────────

def _document_path(campaign_id):
    resp = table_document.scan(
        FilterExpression='campaignId = :c',
        ExpressionAttributeValues={':c': campaign_id},
        ProjectionExpression='documentPath, documentFormat, attachmentType')
    items = resp.get('Items') or []
    return items[0] if items else None


def _head_size(bucket, key):
    try:
        return int(s3.head_object(Bucket=bucket, Key=key).get('ContentLength', 0))
    except Exception as e:
        print('No se pudo leer el tamaño de s3://{}/{}: {}'.format(bucket, key, e))
        return 0


def _summary(sizes, exact, mode, fmt, note):
    """Arma la respuesta. El margen NO se aplica cuando la medida es EXACTA (EAU): ahí no
    hay variabilidad que cubrir, el archivo adjuntado es ese."""
    if not sizes:
        return None
    avg = sum(sizes) / float(len(sizes))
    margin = 0.0 if exact else MARGIN
    with_margin = avg * (1.0 + margin)
    return {
        'mode': mode,
        'format': fmt,
        'exact': exact,
        'samples': len(sizes),
        'avgBytes': int(round(avg)),
        'minBytes': min(sizes),
        'maxBytes': max(sizes),
        'marginPct': int(round(margin * 100)),
        # Se redondea a 2 decimales hacia ARRIBA para no quedar por debajo del peso real.
        'sizeMB': round(with_margin / BYTES_PER_MB + 0.004999, 2),
        'note': note,
    }


def lambda_handler(event, context):
    payload = _get_payload(event)
    auth = _authorizer(event)
    customer_id = auth.get('customerId')
    nit = auth.get('nit') or auth.get('companyTin')
    if not customer_id:
        return _resp(403, 'Sesión sin identidad de cliente.')

    campaign_id = str(payload.get('campaignId', '') or '').strip()
    if not campaign_id:
        return _resp(400, 'Indica la campaña (campaignId).')

    try:
        samples = int(payload.get('samples') or DEFAULT_SAMPLES)
    except (TypeError, ValueError):
        samples = DEFAULT_SAMPLES
    samples = max(1, min(samples, MAX_SAMPLES))

    try:
        campaign = table_campaign.get_item(Key={'campaignId': campaign_id}).get('Item')
        if not campaign:
            return _resp(404, 'La campaña no existe.')
        if campaign.get('customerId') != customer_id:
            return _resp(403, 'La campaña no pertenece a tu cuenta.')

        channel = str(campaign.get('channelName', '') or '').upper()
        if channel not in ('EAU', 'EAP'):
            return _resp(400, 'Solo los canales con adjunto (EAU/EAP) tienen peso que medir.')

        doc = _document_path(campaign_id)
        if not doc or not doc.get('documentPath'):
            return _resp(404, 'La campaña no tiene un documento adjunto registrado.')

        bucket = tenant_bucket(nit)
        doc_path = str(doc['documentPath'])
        fmt = str(campaign.get('documentFormat') or doc.get('documentFormat') or '').upper()

        # ── EAU: el archivo adjunto YA existe y es el mismo para todos → medida exacta.
        if channel == 'EAU':
            size = _head_size(bucket, doc_path)
            if not size:
                return _resp(502, 'No se pudo leer el archivo adjunto en S3.')
            return _resp(200, 'Peso del adjunto medido',
                         _summary([size], True, 'EAU', fmt or 'FILE',
                                  'Peso exacto del archivo adjunto (el mismo para todos los destinatarios).'))

        # ── EAP-DOCX: el combinado pesa ~lo mismo que la plantilla (cambia el texto).
        if fmt != 'PDF':
            size = _head_size(bucket, doc_path)
            if not size:
                return _resp(502, 'No se pudo leer la plantilla del adjunto en S3.')
            return _resp(200, 'Peso aproximado del adjunto',
                         _summary([size], False, 'EAP', fmt or 'DOCX',
                                  'Aproximado sobre la plantilla .docx: la combinación cambia el '
                                  'texto, no los recursos incrustados. Incluye un margen de '
                                  'seguridad del {}%.'.format(int(MARGIN * 100))))

        # ── EAP-PDF: se GENERA uno por destinatario → hay que renderizar de verdad.
        data_path = str(campaign.get('dataPath', '') or '').strip()
        if not data_path:
            return _resp(400, 'La campaña no tiene una base asociada para tomar registros de muestra.')

        headers, rows = _sample_rows(bucket, data_path, samples)
        if not rows:
            return _resp(404, 'No se pudieron leer registros de la base de la campaña.')

        obj = s3.get_object(Bucket=bucket, Key=doc_path)
        raw = obj['Body'].read()
        if isinstance(raw, bytes):
            try:
                raw = raw.decode('utf-8')
            except UnicodeDecodeError:
                raw = raw.decode('latin-1')
        kind, content = _parse_template_content(raw)

        sizes = _render_sizes(kind, content, headers, rows, auth)
        if not sizes:
            return _resp(502, 'No se pudo generar ningún PDF de muestra para medir el peso. '
                              'Revisa que la plantilla del adjunto sea válida.')

        return _resp(200, 'Peso del adjunto medido sobre registros reales',
                     _summary(sizes, False, 'EAP', 'PDF',
                              'Promedio de {} PDF(s) generados con registros reales de la base, '
                              'más un margen de seguridad del {}%.'.format(
                                  len(sizes), int(MARGIN * 100))))
    except ClientError as e:
        print('Error midiendo el adjunto: {}'.format(e))
        return _resp(502, 'No se pudo medir el peso del adjunto.')
    except Exception as e:
        print('Error no controlado midiendo el adjunto: {}'.format(e))
        return _resp(500, 'Error no controlado al medir el peso del adjunto.')
