"""
page_renderer.py

Iterates the pages of a DocumentContext and dispatches each element to its
renderer. Produces a multi-page PDF written to an io.BytesIO buffer.
"""
from __future__ import annotations
import io
import os
from reportlab.pdfgen.canvas import Canvas

from pdf_engine.normalize import DocumentContext
from pdf_engine.style_registry import StyleRegistry, _num
from pdf_engine.font_manager import FontManager
from pdf_engine.coordinate import mm, page_height_pt, page_width_pt

from pdf_engine.renderers.contentarea_renderer import render_contentarea
from pdf_engine.renderers.shape_renderer import render_shape
from pdf_engine.renderers.image_renderer import render_image
from pdf_engine.renderers.qr_renderer import render_qr
from pdf_engine.renderers.barcode_renderer import render_barcode
from pdf_engine.renderers.table_renderer import render_table, measure_dynamic_rows
from pdf_engine.renderers.text_renderer import render_text


def render_pdf(
    ctx: DocumentContext,
    assets_base_path: str = "",
    fonts_base_path: str = "",
) -> bytes:
    """
    Render all pages and return the PDF as bytes.

    Args:
        ctx:               Normalized DocumentContext from normalize.normalize().
        assets_base_path:  Filesystem prefix for resolving image asset URLs.
        fonts_base_path:   Filesystem prefix for resolving custom font paths.
    """
    # Build font manager: system fonts first (lowest priority), then template-declared fonts
    fm = FontManager()
    _load_fonts(fm, ctx.template, fonts_base_path)

    registry = StyleRegistry.from_context(ctx, font_manager=fm)

    buf = io.BytesIO()
    canvas: Canvas | None = None

    # Paginación del FLUJO: cada página del template puede expandirse a VARIAS
    # instancias si una tabla con dataSource no cabe en su alto — las filas
    # sobrantes FLUYEN a una hoja nueva (encabezado repetido; el resto de
    # elementos fijos se repiten como membrete). Antes KeepInFrame las ENCOGÍA.
    visible_pages = [p for p in ctx.pages if p.get("visible", True)]
    page_plans = [(page, _page_instances(page, ctx, registry)) for page in visible_pages]
    total_pages = sum(len(instances) for _, instances in page_plans)

    page_number = 0
    for page, instances in page_plans:
        size = page.get("size", {})
        w_pt = page_width_pt(_num(size.get("width"), 210))
        h_pt = page_height_pt(_num(size.get("height"), 297))

        for rows_overrides in instances:
            page_number += 1
            if canvas is None:
                canvas = Canvas(buf, pagesize=(w_pt, h_pt))
            else:
                canvas.setPageSize((w_pt, h_pt))

            page_vars = {
                "$pageNumber": page_number,
                "$pageCount":  total_pages,
                "$totalPages": total_pages,
            }

            _draw_background(canvas, page, w_pt, h_pt, registry)
            _render_elements(canvas, page, h_pt, ctx, registry, fm, page_vars,
                             assets_base_path, rows_overrides=rows_overrides)
            canvas.showPage()

    if canvas is None:
        canvas = Canvas(buf)
        canvas.showPage()

    canvas.save()
    return buf.getvalue()


# ── Page internals ────────────────────────────────────────────────────────────

def _page_instances(page: dict, ctx: DocumentContext, registry: StyleRegistry) -> list:
    """Plan de instancias (hojas físicas) de una página del template.

    Sin desbordes → `[None]` (una sola hoja, render normal). Si una tabla con
    `dataSource` no cabe en su alto, la página se expande a N hojas: cada
    instancia es un dict `id(elemento) → chunk de filas` que el render usa como
    `rows_override`. El encabezado de la tabla se repite en cada hoja y los
    demás elementos se repiten como membrete. Antes KeepInFrame ENCOGÍA todo.
    """
    chunked: dict[int, list[list]] = {}
    for element in page.get("elements", []):
        if element.get("type") != "table" or not element.get("visible", True):
            continue
        if element.get("body", {}).get("rows"):
            continue  # filas explícitas del editor: no hay flujo que paginar
        source = element.get("dataSource")
        if not source:
            continue
        data = ctx.get_var(source)
        if not isinstance(data, list) or not data:
            continue

        total_w = mm(_num(element.get("width"), 0))
        if total_w <= 0:
            continue
        try:
            header_h, row_hs = measure_dynamic_rows(element, data, registry, total_w)
        except Exception:
            continue  # medición fallida → render normal (con shrink de respaldo)

        avail = mm(_num(element.get("height"), 0)) - header_h
        if avail <= 0 or sum(row_hs) <= avail:
            continue  # cabe completo (o alto inválido) → sin paginación

        # Empaquetado voraz: mínimo 1 fila por hoja (evita bucles con filas
        # más altas que el área — esa fila puntual la encoge KeepInFrame).
        chunks: list[list] = []
        current: list = []
        used = 0.0
        for item, rh in zip(data, row_hs):
            if current and used + rh > avail:
                chunks.append(current)
                current, used = [], 0.0
            current.append(item)
            used += rh
        if current:
            chunks.append(current)
        chunked[id(element)] = chunks

    if not chunked:
        return [None]

    n = max(len(chunks) for chunks in chunked.values())
    return [
        {key: (chunks[i] if i < len(chunks) else [])
         for key, chunks in chunked.items()}
        for i in range(n)
    ]



def _draw_background(
    canvas: Canvas,
    page: dict,
    w_pt: float,
    h_pt: float,
    registry: StyleRegistry,
) -> None:
    bg = page.get("background", {})
    if bg.get("type") == "solid":
        color = registry.rl_color(bg.get("color", "#ffffff"))
        canvas.saveState()
        canvas.setFillColor(color)
        canvas.rect(0, 0, w_pt, h_pt, stroke=0, fill=1)
        canvas.restoreState()


def _render_elements(
    canvas: Canvas,
    page: dict,
    h_pt: float,
    ctx: DocumentContext,
    registry: StyleRegistry,
    fm: FontManager,
    page_vars: dict,
    assets_base_path: str,
    rows_overrides: dict | None = None,
) -> None:
    for element in page.get("elements", []):
        if not element.get("visible", True):
            continue
        if not _check_condition(element, ctx):
            continue

        el_type = element.get("type")

        # `shape` e `image` aplican su rotación internamente; el resto de tipos
        # (texto, contentarea, QR/barcode, tabla) se rota aquí de forma genérica
        # alrededor de su centro (antes la rotación de esos tipos se perdía).
        if el_type == "contentarea":
            _with_rotation(canvas, element, h_pt,
                           lambda: render_contentarea(canvas, element, h_pt, ctx, registry, page_vars))

        elif el_type == "text":
            _with_rotation(canvas, element, h_pt,
                           lambda: render_text(canvas, element, h_pt, registry))

        elif el_type == "shape":
            render_shape(canvas, element, h_pt, registry)

        elif el_type == "image":
            render_image(canvas, element, h_pt, ctx, registry, assets_base_path)

        elif el_type == "qr":
            _with_rotation(canvas, element, h_pt,
                           lambda: render_qr(canvas, element, h_pt, ctx))

        elif el_type == "barcode":
            _with_rotation(canvas, element, h_pt,
                           lambda: render_barcode(canvas, element, h_pt, ctx))

        elif el_type == "table":
            override = (rows_overrides or {}).get(id(element))
            _with_rotation(canvas, element, h_pt,
                           lambda: render_table(canvas, element, h_pt, ctx, registry,
                                                rows_override=override))


def _with_rotation(canvas: Canvas, element: dict, h_pt: float, draw) -> None:
    """Dibuja el elemento rotado alrededor de su centro. En pantalla (Y hacia
    abajo) el ángulo es horario; el PDF tiene Y hacia arriba → `rotate(-rot)`
    reproduce el mismo giro visual (misma convención que shape_renderer)."""
    try:
        rot = float(element.get("rotation") or 0)
    except (TypeError, ValueError):
        rot = 0.0
    if not rot:
        draw()
        return

    def _n(value):
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    cx = mm(_n(element.get("x")) + _n(element.get("width")) / 2.0)
    cy = h_pt - mm(_n(element.get("y")) + _n(element.get("height")) / 2.0)
    canvas.saveState()
    canvas.translate(cx, cy)
    canvas.rotate(-rot)
    canvas.translate(-cx, -cy)
    try:
        draw()
    finally:
        canvas.restoreState()


def _check_condition(element: dict, ctx: DocumentContext) -> bool:
    condition = element.get("condition")
    if not condition:
        return True
    return bool(ctx.get_var(condition))


# ── Font helpers ──────────────────────────────────────────────────────────────

_BUILTIN_FAMILIES = {"helvetica", "times", "courier"}

# Bundled fonts directory shipped alongside this module
_BUNDLED_FONTS_DIR = os.path.join(os.path.dirname(__file__), "..", "fonts")


def _requested_font_families(template: dict) -> list[str]:
    """Return unique non-built-in font families referenced in the template's text styles."""
    families: set[str] = set()
    for ts in template.get("styles", {}).get("text", []):
        family = ts.get("fontFamily", "")
        if family and family.lower() not in _BUILTIN_FAMILIES:
            families.add(family)
    return list(families)


def _load_fonts(fm: FontManager, template: dict, fonts_base_path: str) -> None:
    """
    Load fonts with priority: bundled dir < system fonts < template-declared fonts.
    Only scans for families actually used in the template to keep startup fast.
    """
    families = _requested_font_families(template)
    if families:
        # Bundled fonts/ directory (shipped with the server)
        bundled = os.path.normpath(_BUNDLED_FONTS_DIR)
        fm.load_directory(bundled, families=families)
        # OS system fonts (covers fonts installed by the user)
        fm.load_system_fonts(families=families)
    # Template-declared explicit paths always win (highest priority)
    fm.load_from_template(template, fonts_base_path)
