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
from html.parser import HTMLParser

import boto3
from botocore.client import Config

REGION = 'us-east-1'
BUCKET_PREFIX = os.environ.get('BUCKET_PREFIX', 'mailconnect')
# Tope defensivo para descargar imágenes remotas del template (evita adjuntos gigantes/colgar el render).
IMG_MAX_BYTES = int(os.environ.get('PDF_IMG_MAX_BYTES', str(8 * 1024 * 1024)))
IMG_TIMEOUT = int(os.environ.get('PDF_IMG_TIMEOUT', '10'))
# Imágenes remotas ya descargadas en ESTA invocación: {url: ruta en /tmp}.
_IMG_CACHE = {}

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
# ---------------------------------------------------------------------------
# Configuración de PÁGINA del documento (tamaño, orientación, márgenes,
# encabezado y pie con número de página).
#
# ⚠️ La configuración viaja DENTRO del propio HTML, en los `data-*` del envoltorio
# `data-mc-doc` que emite el editor, y no como parámetros del endpoint. Es a
# propósito: en el envío real el combinador (`Combination-EAP-PDF`) recibe la
# plantilla por SQS y NO conoce nada de lo que el cliente configuró en el editor.
# Guardándolo en el documento, la vista previa y el envío real usan lo mismo sin
# tocar el esquema de `messageTemplate` ni el mensaje de la cola.
# ---------------------------------------------------------------------------
PAGE_DIMS_CM = {          # (ancho, alto) en VERTICAL
    'A4': (21.0, 29.7),
    'CARTA': (21.59, 27.94),
    'LETTER': (21.59, 27.94),
}
DEFAULT_MARGIN_CM = 2.0
BAND_CM = 1.0             # alto de la banda de encabezado / pie
BAND_GAP_CM = 0.3         # aire entre la banda y el contenido


def _cm(valor):
    """Número en cm sin el `.0` sobrante: 2.0 → "2", 1.5 → "1.5"."""
    return ('%g' % round(float(valor), 3))


def _clamp(valor, minimo, maximo):
    return max(minimo, min(maximo, valor))


def _parse_margins(raw):
    """`data-mc-margin` en cm, formato CSS: "2" · "2 3" · "2 3 2 3" (arriba der abajo izq)."""
    partes = []
    for tok in str(raw or '').replace(',', ' ').split():
        try:
            partes.append(_clamp(float(tok), 0.0, 10.0))
        except ValueError:
            pass
    if not partes:
        return (DEFAULT_MARGIN_CM,) * 4
    if len(partes) == 1:
        return (partes[0],) * 4
    if len(partes) == 2:
        return (partes[0], partes[1], partes[0], partes[1])
    if len(partes) == 3:
        return (partes[0], partes[1], partes[2], partes[1])
    return tuple(partes[:4])


def _doc_attrs(html):
    """Lee los `data-*` de la etiqueta de apertura del envoltorio `data-mc-doc`.

    Solo se mira ESA etiqueta (una sola, con un regex acotado a `<div ...>`), no el
    documento completo: parsear HTML con expresiones regulares es frágil, pero leer
    los atributos de una etiqueta de apertura conocida no lo es."""
    m = re.search(r'<div[^>]*\bdata-mc-doc\b[^>]*>', html or '', re.I)
    if not m:
        return {}
    tag = m.group(0)
    return {k.lower(): v for k, v in re.findall(
        r'(data-mc-[a-z-]+)\s*=\s*"([^"]*)"', tag, re.I)}


def _doc_font(html):
    """Tipografía del envoltorio del documento, para poder repetirla en las bandas."""
    tag = re.search(r'<div[^>]*\bdata-mc-doc\b[^>]*>', html or '', re.I)
    if not tag:
        return ''
    fuente = re.search(r'font-family\s*:\s*([^;"\']+)', tag.group(0), re.I)
    return fuente.group(1).strip() if fuente else ''


class _MarkedExtractor(HTMLParser):
    """Encuentra el elemento que lleva `attr` y devuelve su contenido y sus límites.

    Se usa `html.parser` de la stdlib (no BeautifulSoup, que no está garantizada en el
    layer) llevando la cuenta de la profundidad, para cerrar en la etiqueta correcta
    aunque el encabezado tenga divs anidados dentro."""

    def __init__(self, attr):
        HTMLParser.__init__(self, convert_charrefs=False)
        self.attr = attr.lower()
        self.inicio = None
        self.fin = None
        self._profundidad = 0
        self._dentro = False
        self._contenido_desde = None

    def handle_starttag(self, tag, attrs):
        if self._dentro:
            if tag == self._tag:
                self._profundidad += 1
            return
        if self.inicio is not None:
            return
        if any(k.lower() == self.attr for k, _ in attrs):
            self._dentro = True
            self._tag = tag
            self._profundidad = 1
            self.inicio = self.getpos()
            self._contenido_desde = None

    def handle_endtag(self, tag):
        if not self._dentro or tag != self._tag:
            return
        self._profundidad -= 1
        if self._profundidad == 0:
            self._dentro = False
            self.fin = self.getpos()


def _offset(html, pos):
    """(línea, columna) de HTMLParser → índice absoluto en la cadena."""
    linea, col = pos
    idx = 0
    for _ in range(linea - 1):
        idx = html.index('\n', idx) + 1
    return idx + col


def _extract_marked(html, attr):
    """Saca del HTML el elemento marcado con `attr`. Devuelve (contenido, resto).

    El encabezado y el pie se EXTRAEN del flujo: xhtml2pdf los coloca en su marco
    estático por `-pdf-frame-content`, así que deben emitirse una sola vez y no
    quedar además en medio del contenido."""
    if not html or attr not in html.lower():
        return '', html
    try:
        p = _MarkedExtractor(attr)
        p.feed(html)
        p.close()
        if p.inicio is None or p.fin is None:
            return '', html
        ini = _offset(html, p.inicio)
        cierre = html.find('>', _offset(html, p.fin))
        if cierre < 0:
            return '', html
        bloque = html[ini:cierre + 1]
        interno = bloque[bloque.index('>') + 1:bloque.rindex('<')]
        return interno, html[:ini] + html[cierre + 1:]
    except Exception as e:
        # Ante un HTML raro se prefiere dejarlo en el flujo (el encabezado saldría una vez,
        # en medio del documento) antes que tumbar el render entero.
        print('No se pudo extraer {}: {}'.format(attr, e))
        return '', html


def _page_tokens(html):
    """`[[pagina]]`/`[[paginas]]` → las etiquetas de numeración de xhtml2pdf.

    ⚠️ Se usan corchetes y NO `{{…}}` a propósito: las llaves son el formato de las
    variables de la BASE DE DATOS y `render_variables` corre ANTES que esto, así que
    una columna del CSV llamada "pagina" habría pisado el número de página."""
    out = str(html or '')
    out = re.sub(r'\[\[\s*paginas\s*\]\]', '<pdf:pagecount />', out, flags=re.I)
    out = re.sub(r'\[\[\s*pagina\s*\]\]', '<pdf:pagenumber />', out, flags=re.I)
    return out


def page_setup(html, page_size='A4'):
    """Configuración efectiva del documento: lo que diga el HTML manda sobre el parámetro."""
    attrs = _doc_attrs(html)
    tamano = str(attrs.get('data-mc-size') or page_size or 'A4').upper()
    if tamano not in PAGE_DIMS_CM:
        tamano = 'A4'
    apaisado = str(attrs.get('data-mc-orientation', '')).lower() == 'landscape'
    ancho, alto = PAGE_DIMS_CM[tamano]
    if apaisado:
        ancho, alto = alto, ancho
    mt, mr, mb, ml = _parse_margins(attrs.get('data-mc-margin'))
    # Un margen absurdo dejaría el contenido sin ancho útil: se acota a la mitad de la hoja.
    ml = _clamp(ml, 0.0, ancho / 2 - 1)
    mr = _clamp(mr, 0.0, ancho / 2 - 1)
    mt = _clamp(mt, 0.0, alto / 2 - 1)
    mb = _clamp(mb, 0.0, alto / 2 - 1)
    return {
        'size': 'Letter' if tamano in ('CARTA', 'LETTER') else 'A4',
        'landscape': apaisado,
        'width': ancho, 'height': alto,
        'margins': (mt, mr, mb, ml),
    }


def _page_css(cfg, con_encabezado, con_pie):
    """CSS de `@page`. Con encabezado o pie se usan MARCOS (`@frame`) de xhtml2pdf.

    ⚠️ Sin encabezado ni pie se emite el `@page` simple de siempre: declarar marcos
    cambia el modelo de maquetación (el contenido pasa a fluir en un marco explícito),
    y no hay razón para exponer a ese cambio a los documentos que no los usan."""
    mt, mr, mb, ml = cfg['margins']
    orient = ' landscape' if cfg['landscape'] else ''
    borde = '@page {{ size: {}{}; margin: {}cm {}cm {}cm {}cm;'.format(
        cfg['size'], orient, _cm(mt), _cm(mr), _cm(mb), _cm(ml))
    if not con_encabezado and not con_pie:
        return borde + ' }'

    # El encabezado y el pie viven DENTRO del margen. Si el margen no da para la banda,
    # el contenido se corre hacia adentro en vez de que la banda se monte sobre el texto.
    alto_sup = (BAND_CM + BAND_GAP_CM) if con_encabezado else 0.0
    alto_inf = (BAND_CM + BAND_GAP_CM) if con_pie else 0.0
    contenido_top = max(mt, alto_sup)
    contenido_bot = max(mb, alto_inf)
    ancho_util = cfg['width'] - ml - mr
    alto_util = cfg['height'] - contenido_top - contenido_bot

    partes = [borde]
    if con_encabezado:
        partes.append(
            ' @frame mc_header_frame {{ -pdf-frame-content: mc_header;'
            ' left: {}cm; width: {}cm; top: {}cm; height: {}cm; }}'.format(
                _cm(ml), _cm(ancho_util),
                _cm(max(0.2, contenido_top - BAND_CM - BAND_GAP_CM)), _cm(BAND_CM)))
    partes.append(
        ' @frame mc_content_frame {{ left: {}cm; width: {}cm; top: {}cm; height: {}cm; }}'.format(
            _cm(ml), _cm(ancho_util), _cm(contenido_top), _cm(alto_util)))
    if con_pie:
        partes.append(
            ' @frame mc_footer_frame {{ -pdf-frame-content: mc_footer;'
            ' left: {}cm; width: {}cm; top: {}cm; height: {}cm; }}'.format(
                _cm(ml), _cm(ancho_util),
                _cm(cfg['height'] - contenido_bot + BAND_GAP_CM), _cm(BAND_CM)))
    partes.append(' }')
    # ⚠️ Sin `.format()` final: a esta altura la cadena ya trae las llaves LITERALES del
    # CSS, y `str.format` sobre ellas lanza ValueError.
    return ''.join(partes)


def wrap_html(inner, page_size='A4'):
    """Envuelve el HTML del editor en un documento con marco de página.

    Lee del propio HTML el tamaño, la orientación, los márgenes y —si los hay— el
    encabezado y el pie, que se extraen del flujo y se emiten como contenido de sus
    marcos estáticos para que se repitan en TODAS las hojas.
    """
    inner = inner or ''
    encabezado, inner = _extract_marked(inner, 'data-mc-header')
    pie, inner = _extract_marked(inner, 'data-mc-footer')
    encabezado, pie = encabezado.strip(), pie.strip()
    cfg = page_setup(inner, page_size)
    page = _page_css(cfg, bool(encabezado), bool(pie))

    # Las bandas salen del envoltorio al extraerse, así que perderían su tipografía: se les
    # vuelve a poner la del documento para que el membrete no quede en otra fuente.
    fuente = _doc_font(inner)
    estilo_banda = ' style="font-family:{}"'.format(fuente) if fuente else ''

    bandas = ''
    if encabezado:
        bandas += '<div id="mc_header" class="mc-band"{}>{}</div>'.format(
            estilo_banda, _page_tokens(encabezado))
    if pie:
        bandas += '<div id="mc_footer" class="mc-band"{}>{}</div>'.format(
            estilo_banda, _page_tokens(pie))

    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
        + page +
        ' body { font-family: Arial, Helvetica, sans-serif; font-size: 12pt; color: #111; line-height: 1.5; }'
        ' h1 { font-size: 22pt; } h2 { font-size: 18pt; } h3 { font-size: 15pt; }'
        ' img { max-width: 100%; }'
        ' table { border-collapse: collapse; width: 100%; }'
        ' td, th { border: 1px solid #cbd5e1; padding: 6px; }'
        ' blockquote { border-left: 3px solid #cbd5e1; margin: 8px 0; padding-left: 10px; color: #555; }'
        ' .mc-band { font-size: 9pt; color: #555; }'
        '</style></head><body>' + bandas + inner + '</body></html>'
    )


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




def _link_callback(uri, rel):
    """Resuelve el `src` de las imágenes: descarga http(s) a /tmp para que xhtml2pdf las
    embeba. data: URIs las maneja pisa directamente. Con tope de tamaño y timeout."""
    try:
        if uri.startswith('http://') or uri.startswith('https://'):
            # CACHE por URL. Sin esto, la MISMA imagen se descargaba una vez por destinatario
            # (el combinador renderiza 100 PDFs por invocación): 100 peticiones HTTP idénticas
            # y 100 copias del mismo archivo en /tmp.
            if uri in _IMG_CACHE:
                return _IMG_CACHE[uri]
            ext = os.path.splitext(uri.split('?')[0])[1] or '.img'
            fd, path = tempfile.mkstemp(suffix=ext, dir='/tmp')
            os.close(fd)
            req = urllib.request.Request(uri, headers={'User-Agent': 'mailconnect-pdf'})
            with urllib.request.urlopen(req, timeout=IMG_TIMEOUT) as resp:
                data = resp.read(IMG_MAX_BYTES + 1)
            if len(data) > IMG_MAX_BYTES:
                print('Imagen ignorada por tamaño (> {} bytes): {}'.format(IMG_MAX_BYTES, uri))
                os.unlink(path)          # el temporal ya estaba creado: no dejarlo huérfano
                return uri
            with open(path, 'wb') as f:
                f.write(data)
            _IMG_CACHE[uri] = path
            return path
    except Exception as e:
        print('link_callback no pudo obtener {}: {}'.format(uri, e))
    return uri


def _limpiar_imagenes():
    """Borra las imágenes descargadas a /tmp y vacía la caché.

    ⚠️ Lambda REUTILIZA el contenedor entre invocaciones y `/tmp` persiste, con un tope de
    512 MB por defecto. Sin esta limpieza los archivos se acumulaban invocación tras
    invocación hasta 'No space left on device' — y el fallo aparecía a mitad de un lote, en
    una lambda que ya había enviado parte de los correos. Con el tope de imagen en 8 MB,
    bastaban unas pocas invocaciones tibias para llenarlo.
    """
    for p in _IMG_CACHE.values():
        try:
            os.unlink(p)
        except OSError:
            pass
    _IMG_CACHE.clear()


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
    """Envoltorio del handler real.

    Su única razón de ser: garantizar que las imágenes descargadas a /tmp se borren SIEMPRE,
    también si el render lanza. Se hace aquí y no dentro porque el handler tiene varios
    `return` y envolverlo en un try/finally obligaría a reindentarlo entero.
    """
    try:
        return _handler(event, context)
    finally:
        _limpiar_imagenes()


def _handler(event, context):
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
