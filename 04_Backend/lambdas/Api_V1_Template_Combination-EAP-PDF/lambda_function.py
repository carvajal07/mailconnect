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
from html.parser import HTMLParser

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
# Imágenes remotas ya descargadas en ESTA invocación: {url: ruta en /tmp}.
_IMG_CACHE = {}

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

    def _as_text(value):
        # Valores coercionados a lista/objeto (celdas JSON) vuelven a texto JSON en
        # el camino HTML (str() imprimiría el repr de Python).
        if isinstance(value, (list, dict)):
            return json.dumps(value, ensure_ascii=False)
        return str(value)

    def repl(match):
        key = match.group(1).strip()
        if key in mapping:
            return _as_text(mapping[key])
        if _norm_key(key) in norm:
            return _as_text(norm[_norm_key(key)])
        return match.group(0)

    return re.sub(r'\{\{\s*([^{}]+?)\s*\}\}', repl, html)


def _coerce_json_cell(value):
    """Una celda cuyo texto ES JSON ('[…]' o '{…}') se parsea a su lista/objeto: así
    una columna con un ARRAY de ítems alimenta el `dataSource` de las tablas del
    Estudio (una fila repetida por ítem, con paginación si desborda). Si no parsea,
    queda como texto literal (una llave suelta no rompe nada)."""
    if isinstance(value, str):
        s = value.strip()
        if s[:1] in ('[', '{'):
            try:
                return json.loads(s)
            except (ValueError, TypeError):
                return value
    return value


def row_mapping(headers, row):
    """Construye {header: valor} desde una fila posicional del CSV. El BOM del primer
    encabezado ('\ufeff', típico de CSV exportados de Excel) se quita de la clave.
    Las celdas con JSON embebido (arrays/objetos de las bases .json) se parsean."""
    mapping = {}
    for i, head in enumerate(headers or []):
        value = row[i] if row and i < len(row) else ''
        value = '' if value is None else str(value)
        mapping[str(head).replace('\ufeff', '')] = _coerce_json_cell(value)
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




def _link_callback(uri, rel):
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
