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
from pdf_engine.coordinate import page_height_pt, page_width_pt

from pdf_engine.renderers.contentarea_renderer import render_contentarea
from pdf_engine.renderers.shape_renderer import render_shape
from pdf_engine.renderers.image_renderer import render_image
from pdf_engine.renderers.qr_renderer import render_qr
from pdf_engine.renderers.barcode_renderer import render_barcode
from pdf_engine.renderers.table_renderer import render_table
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
    total_pages = len([p for p in ctx.pages if p.get("visible", True)])

    page_number = 0
    for page in ctx.pages:
        if not page.get("visible", True):
            continue

        page_number += 1
        size = page.get("size", {})
        w_pt = page_width_pt(_num(size.get("width"), 210))
        h_pt = page_height_pt(_num(size.get("height"), 297))

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
        _render_elements(canvas, page, h_pt, ctx, registry, fm, page_vars, assets_base_path)
        canvas.showPage()

    if canvas is None:
        canvas = Canvas(buf)
        canvas.showPage()

    canvas.save()
    return buf.getvalue()


# ── Page internals ────────────────────────────────────────────────────────────

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
) -> None:
    for element in page.get("elements", []):
        if not element.get("visible", True):
            continue
        if not _check_condition(element, ctx):
            continue

        el_type = element.get("type")

        if el_type == "contentarea":
            render_contentarea(canvas, element, h_pt, ctx, registry, page_vars)

        elif el_type == "text":
            render_text(canvas, element, h_pt, registry)

        elif el_type == "shape":
            render_shape(canvas, element, h_pt, registry)

        elif el_type == "image":
            render_image(canvas, element, h_pt, ctx, registry, assets_base_path)

        elif el_type == "qr":
            render_qr(canvas, element, h_pt, ctx)

        elif el_type == "barcode":
            render_barcode(canvas, element, h_pt, ctx)

        elif el_type == "table":
            render_table(canvas, element, h_pt, ctx, registry)


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
