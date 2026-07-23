"""
sketch_translator.py — Traductor del JSON de pdfsketch (nivel MEDIO del portal)
al `templateJson` estándar que consume el motor (`pdf_engine`).

Entrada aceptada (las dos formas):
  - Envelope versionado:  { "schema": "pdfsketch@1", "document": { ...DocumentModel... } }
  - DocumentModel directo (dict con "pages")

El DocumentModel es el modelo del editor pdfsketch (ver `src/types/document.ts`
del editor): páginas con elementos `text | rect | circle | line | pen | image |
table | qr | dataField | frame | flowable`, en la unidad del documento
(`doc.unit` ∈ mm | pt | px; default mm).

Salida: `templateJson` (mm, esquema del motor) listo para `normalize()` +
`render_pdf()`.

Mapeo y limitaciones (v1):
  - text sin variables  → elemento `text` (alineación y estilo inline).
  - text CON variables (spans con `binding` o `{{ruta}}` en el texto) y
    dataField → `contentarea` con `<span class="var-tag" data-var="ruta">`
    (el motor resuelve rutas con punto: `persona.nombre`). La alineación
    dentro de contentarea sale a la izquierda (limitación del motor).
  - rect → shape rectangle · circle → shape ellipse · frame → shape rectangle.
  - line → se aproxima con un rectángulo relleno del color del trazo (el motor
    no dibuja líneas sueltas); pen (trazo libre) y flowable se OMITEN.
  - image → `image` con `source.kind='url'` (URLs http(s), p. ej. el prefijo
    público `resources/` del bucket del cliente). Los `data:` URI se omiten.
  - table → modelo simple del motor (header/body/dataSource/alternateRowFill).
    `repeatBy` (variable con lista de filas) → `dataSource`. Las variables
    `{{...}}` dentro de celdas literales NO se resuelven (limitación del motor).
  - qr → `qr`; otros códigos (CODE128, EAN13…) → `barcode` con su `symbology`.
    `variable` definido → `valueSource='variable'`.
  - rotation se ignora (salvo en imágenes, que el motor sí rota).

Los elementos no soportados se registran en `result["warnings"]` para que el
front pueda avisar, sin romper el render del resto del documento.
"""
from __future__ import annotations

import re

MM_PER_PT = 25.4 / 72.0
MM_PER_PX = 25.4 / 96.0

_VAR_RE = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")

_BARCODE_SYMBOLOGY = {
    "CODE128": "CODE128",
    "CODE39": "CODE39",
    "EAN13": "EAN13",
    "EAN8": "EAN8",
    "ITF14": "ITF14",
    "UPC": "UPCA",
}

_ALIGN_MAP = {
    "left": "left",
    "center": "center",
    "right": "right",
    "justify-left": "justify",
    "justify-center": "justify",
    "justify-right": "justify",
    "justify-block": "justify",
}


def translate_sketch(payload: dict) -> dict:
    """Punto de entrada. Devuelve {"templateJson": dict, "warnings": [str]}."""
    doc = payload.get("document") if isinstance(payload.get("document"), dict) else payload
    if not isinstance(doc, dict) or not isinstance(doc.get("pages"), list):
        raise ValueError("El JSON de pdfsketch no tiene 'pages' (¿es un DocumentModel?).")

    unit = str(doc.get("unit") or "mm").lower()
    tr = _Translator(unit)
    for page in doc.get("pages", []):
        tr.add_page(page)

    return {"templateJson": tr.build(doc), "warnings": tr.warnings}


class _Translator:
    def __init__(self, unit: str):
        self.unit = unit
        self.pages: list[dict] = []
        self.content_areas: list[dict] = []
        self.text_styles: list[dict] = []
        self._style_cache: dict[tuple, str] = {}
        self.warnings: list[str] = []
        self._seq = 0

    # ── unidades ─────────────────────────────────────────────────────────────
    def mm(self, value, unit: str | None = None) -> float:
        try:
            v = float(value)
        except (TypeError, ValueError):
            return 0.0
        u = (unit or self.unit or "mm").lower()
        if u == "pt":
            return v * MM_PER_PT
        if u == "px":
            return v * MM_PER_PX
        return v

    def _id(self, prefix: str) -> str:
        self._seq += 1
        return "{}_{}".format(prefix, self._seq)

    # ── estilos ──────────────────────────────────────────────────────────────
    def text_style_id(self, font_family, font_size_pt, color, bold, italic) -> str:
        key = (font_family or "Helvetica", float(font_size_pt or 12),
               color or "#111111", bool(bold), bool(italic))
        if key in self._style_cache:
            return self._style_cache[key]
        ts_id = self._id("ts")
        self.text_styles.append({
            "id": ts_id, "name": ts_id,
            "fontFamily": key[0], "fontWeight": "Bold" if key[3] else "Regular",
            "fontSize": key[1], "color": key[2],
            "italic": key[4], "underline": False, "strikethrough": False,
            "letterSpacing": 0, "lineHeight": 1.35, "textTransform": "none",
        })
        self._style_cache[key] = ts_id
        return ts_id

    # ── páginas ──────────────────────────────────────────────────────────────
    def add_page(self, page: dict) -> None:
        size = page.get("size") or {}
        page_unit = str(size.get("unit") or self.unit).lower()
        margins = page.get("margin") or {}
        elements = []
        for el in page.get("elements") or []:
            out = self.translate_element(el)
            if out:
                elements.append(out)

        self.pages.append({
            "id": page.get("id") or self._id("pg"),
            "name": page.get("name") or "Página",
            "visible": page.get("visible", True),
            "size": {
                "width": self.mm(size.get("width", 210), page_unit),
                "height": self.mm(size.get("height", 297), page_unit),
                "unit": "mm",
            },
            "margins": {k: self.mm(margins.get(k, 0)) for k in ("top", "right", "bottom", "left")},
            "background": ({"type": "solid", "color": page.get("background")}
                           if _is_color(page.get("background")) else {"type": "none"}),
            "elements": elements,
        })

    # ── elementos ────────────────────────────────────────────────────────────
    def translate_element(self, el: dict) -> dict | None:
        el_type = el.get("type")
        base = {
            "id": el.get("id") or self._id("el"),
            "x": self.mm(el.get("x")), "y": self.mm(el.get("y")),
            "width": self.mm(el.get("width")), "height": self.mm(el.get("height")),
            "visible": el.get("visible", True),
            "condition": None,
        }

        if el_type == "text":
            return self._text(el, base)
        if el_type == "dataField":
            return self._data_field(el, base)
        if el_type == "rect" or el_type == "frame":
            return self._rect(el, base)
        if el_type == "circle":
            return self._circle(el, base)
        if el_type == "line":
            return self._line(el, base)
        if el_type == "image":
            return self._image(el, base)
        if el_type == "table":
            return self._table(el, base)
        if el_type == "qr":
            return self._barcode(el, base)

        self.warnings.append(
            "Elemento '{}' ({}) no soportado por el motor; se omitió.".format(
                el.get("name") or el.get("id"), el_type))
        return None

    def _has_vars(self, el: dict) -> bool:
        if any(s.get("binding") for s in el.get("spans") or []):
            return True
        return bool(_VAR_RE.search(el.get("text") or ""))

    def _text(self, el: dict, base: dict) -> dict:
        bold = (el.get("fontWeight") or 400) >= 600
        italic = el.get("fontStyle") == "italic"
        if not self._has_vars(el):
            base.update({
                "type": "text",
                "content": el.get("text") or "",
                "textStyleId": self.text_style_id(
                    el.get("fontFamily"), el.get("fontSize"), el.get("color"), bold, italic),
                "textStyle": {},
                "paragraphStyle": {
                    "alignment": _ALIGN_MAP.get(el.get("align") or "left", "left"),
                    "paddingTop": 0, "paddingRight": 0, "paddingBottom": 0, "paddingLeft": 0,
                },
            })
            return base

        # Texto con variables → contentarea con var-tags
        ts_id = self.text_style_id(
            el.get("fontFamily"), el.get("fontSize"), el.get("color"), bold, italic)
        html = self._spans_to_html(el)
        return self._make_contentarea(base, html, ts_id)

    def _spans_to_html(self, el: dict) -> str:
        spans = el.get("spans") or []
        if spans:
            parts = []
            for s in spans:
                if s.get("binding"):
                    parts.append(_var_tag(s["binding"]))
                else:
                    parts.append(_text_to_html(s.get("text") or ""))
            return "<p>{}</p>".format("".join(parts))
        # Sin spans: texto plano con {{ruta}} embebidas
        text = el.get("text") or ""
        out, last = [], 0
        for m in _VAR_RE.finditer(text):
            out.append(_text_to_html(text[last:m.start()]))
            out.append(_var_tag(m.group(1)))
            last = m.end()
        out.append(_text_to_html(text[last:]))
        return "<p>{}</p>".format("".join(out))

    def _data_field(self, el: dict, base: dict) -> dict:
        ts_id = self.text_style_id(
            el.get("fontFamily"), el.get("fontSize"), el.get("color"), False, False)
        html = "<p>{}</p>".format(_var_tag(el.get("binding") or ""))
        return self._make_contentarea(base, html, ts_id)

    def _make_contentarea(self, base: dict, html: str, ts_id: str) -> dict:
        area_id = self._id("area")
        self.content_areas.append({
            "id": area_id, "type": "simple", "label": area_id,
            "height": base["height"], "content": html,
            "elements": [], "children": [], "visible": True, "condition": None,
            "defaultTextStyleId": ts_id,
        })
        base.update({"type": "contentarea", "areaRef": area_id,
                     "border": None, "fill": None})
        return base

    def _rect(self, el: dict, base: dict) -> dict:
        base.update({
            "type": "shape", "shape": "rectangle",
            "fill": _fill(el.get("fill")),
            "border": _border(el.get("stroke"), el.get("strokeWidth"),
                              radius_mm=self.mm(el.get("cornerRadius") or 0)),
        })
        return base

    def _circle(self, el: dict, base: dict) -> dict:
        base.update({
            "type": "shape", "shape": "ellipse",
            "fill": _fill(el.get("fill")),
            "border": _border(el.get("stroke"), el.get("strokeWidth")),
        })
        return base

    def _line(self, el: dict, base: dict) -> dict:
        # El motor no dibuja líneas sueltas: se aproxima con un rectángulo
        # relleno del color del trazo, con grosor mínimo visible.
        stroke_mm = max(self.mm(el.get("strokeWidth") or 1, "pt"), 0.3)
        if base["height"] <= base["width"]:
            base["height"] = max(base["height"], stroke_mm)
        else:
            base["width"] = max(base["width"], stroke_mm)
        base.update({
            "type": "shape", "shape": "rectangle",
            "fill": {"type": "solid", "color": el.get("stroke") or "#000000", "opacity": 1},
            "border": None,
        })
        return base

    def _image(self, el: dict, base: dict) -> dict | None:
        src = el.get("src") or ""
        if src.startswith("data:"):
            self.warnings.append(
                "Imagen '{}' con data-URI omitida (sube la imagen a S3 y usa su URL)."
                .format(el.get("name") or el.get("id")))
            src = ""
        base.update({
            "type": "image",
            "source": {"kind": "url", "url": src} if src else {"kind": "placeholder"},
            "fit": "contain",
            "rotation": el.get("rotation") or 0,
            "border": None,
        })
        return base

    def _table(self, el: dict, base: dict) -> dict:
        columns = []
        for col in el.get("columns") or []:
            columns.append({
                "id": col.get("header") or "col{}".format(len(columns) + 1),
                "label": col.get("header") or "",
                "width": col.get("widthPercent") or (100 / max(len(el.get("columns") or []), 1)),
                "widthUnit": "%",
            })

        rows = el.get("rows") or []
        has_header = bool(el.get("hasHeader"))
        header_rows, body_rows = [], rows
        if has_header and rows:
            header_rows, body_rows = [rows[0]], rows[1:]

        def to_row(cells):
            return {"cells": [{"content": (c or {}).get("text", "")} for c in cells]}

        border_w = el.get("borderWidth") or 0
        border_c = el.get("borderColor") or "#d1d5db"
        border_cfg = {"mode": "unified",
                      "unified": {"enabled": border_w > 0, "width": border_w, "color": border_c}}

        base.update({
            "type": "table",
            "columns": columns,
            "header": {"enabled": has_header, "rows": [to_row(r) for r in header_rows]},
            "body": {"rows": [to_row(r) for r in body_rows] if not el.get("repeatBy") else []},
            "footer": {"enabled": False},
            "dataSource": el.get("repeatBy") or None,
            "tableBorder": border_cfg,
            "cellBorder": border_cfg,
            "alternateRowFill": ({"type": "solid", "color": el.get("alternateBackground") or "#f9fafb"}
                                 if el.get("alternateRows") else None),
            "border": None,
        })
        if any(_VAR_RE.search((c or {}).get("text") or "") for r in rows for c in r):
            self.warnings.append(
                "La tabla '{}' tiene variables {{...}} en celdas literales; el motor solo "
                "resuelve variables en tablas con 'repeatBy' (dataSource).".format(
                    el.get("name") or el.get("id")))
        return base

    def _barcode(self, el: dict, base: dict) -> dict:
        b_type = (el.get("barcodeType") or "QR").upper()
        value = el.get("variable") or el.get("data") or ""
        common = {
            "valueSource": "variable" if el.get("variable") else "static",
            "value": value,
            "foreground": "#000000", "background": "#ffffff",
        }
        if b_type == "QR":
            base.update({"type": "qr",
                         "errorCorrection": el.get("errorLevel") or "M", **common})
        else:
            base.update({"type": "barcode",
                         "symbology": _BARCODE_SYMBOLOGY.get(b_type, "CODE128"),
                         "showText": el.get("showText", True), **common})
        return base

    # ── ensamblado ───────────────────────────────────────────────────────────
    def build(self, doc: dict) -> dict:
        if not any(ts["id"] == "ts_default" for ts in self.text_styles):
            self.text_styles.insert(0, {
                "id": "ts_default", "name": "Default",
                "fontFamily": "Helvetica", "fontWeight": "Regular", "fontSize": 12,
                "color": "#111111", "italic": False, "underline": False,
                "strikethrough": False, "letterSpacing": 0, "lineHeight": 1.35,
                "textTransform": "none",
            })
        return {
            "version": "1.0",
            "id": doc.get("id") or "sketch",
            "name": doc.get("name") or "Documento pdfsketch",
            "pages": self.pages,
            "contentAreas": self.content_areas,
            "styles": {
                "text": self.text_styles,
                "paragraph": [{
                    "id": "ps_default", "name": "Default", "alignment": "left",
                    "verticalAlign": "top", "lineHeight": 1.35,
                }],
                "border": [], "fill": [], "cell": [], "line": [],
            },
            "colors": [], "images": [], "fonts": [],
            "outputChannels": ["pdf"],
        }


# ── helpers de módulo ─────────────────────────────────────────────────────────

def _is_color(value) -> bool:
    return isinstance(value, str) and value.startswith("#")


def _esc(text: str) -> str:
    return (str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _text_to_html(text: str) -> str:
    return _esc(text).replace("\n", "<br>")


def _var_tag(path: str) -> str:
    path = str(path).strip()
    return '<span class="var-tag" data-var="{}">{{{{{}}}}}</span>'.format(_esc(path), _esc(path))


def _fill(color) -> dict | None:
    if not _is_color(color):
        return None
    return {"type": "solid", "color": color, "opacity": 1}


def _border(color, width, radius_mm: float = 0) -> dict | None:
    try:
        w = float(width or 0)
    except (TypeError, ValueError):
        w = 0
    if w <= 0 or not _is_color(color):
        return None
    # El motor interpreta el ancho del borde en mm; el editor lo maneja en pt.
    return {
        "mode": "unified",
        "unified": {"enabled": True, "width": round(w * MM_PER_PT, 3), "style": "solid", "color": color},
        "sides": {},
        "radius": {"mode": "unified", "unified": radius_mm},
    }
