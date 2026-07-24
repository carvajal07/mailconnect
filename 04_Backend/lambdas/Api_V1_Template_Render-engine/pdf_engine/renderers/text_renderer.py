"""
text_renderer.py

Renders a standalone `text` element — a fixed-position text box with optional
fill background, border, padding, and basic inline formatting.

The element's `content` field is plain text (no HTML). Inline styles come from
the element's textStyle dict and paragraphStyle dict (both inlined on the element,
not referenced by ID for this element type).
"""

from __future__ import annotations
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph as RLParagraph, Frame, KeepInFrame
from reportlab.lib.styles import ParagraphStyle as RLParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY

from pdf_engine.coordinate import element_rect, mm
from pdf_engine.style_registry import StyleRegistry
from pdf_engine.renderers.border_renderer import draw_border

_ALIGN_MAP = {
    "left":    TA_LEFT,
    "center":  TA_CENTER,
    "right":   TA_RIGHT,
    "justify": TA_JUSTIFY,
}

_VALIGN_TOP    = "top"
_VALIGN_MIDDLE = "middle"
_VALIGN_BOTTOM = "bottom"


def render_text(
    canvas: Canvas,
    element: dict,
    page_h_pt: float,
    registry: StyleRegistry,
) -> None:
    x, y, w, h = element_rect(
        element["x"], element["y"], element["width"], element["height"], page_h_pt
    )

    # ── Background fill ───────────────────────────────────────────────────────
    fill = element.get("fill")
    if fill and fill.get("type") == "solid":
        color = registry.rl_color(fill.get("color", "#ffffff"), fill.get("opacity", 1.0))
        canvas.saveState()
        canvas.setFillColor(color)
        canvas.rect(x, y, w, h, stroke=0, fill=1)
        canvas.restoreState()

    # ── Border ────────────────────────────────────────────────────────────────
    draw_border(canvas, x, y, w, h, element.get("border"), registry)

    # ── Text content ──────────────────────────────────────────────────────────
    content = element.get("content", "").strip()
    if not content:
        return

    ts_id = element.get("textStyleId", "ts_default")
    ts = registry.text(ts_id)

    inline_ts = element.get("textStyle", {})
    para_cfg = element.get("paragraphStyle", {})

    padding_top    = mm(para_cfg.get("paddingTop", 2))
    padding_right  = mm(para_cfg.get("paddingRight", 3))
    padding_bottom = mm(para_cfg.get("paddingBottom", 2))
    padding_left   = mm(para_cfg.get("paddingLeft", 3))

    alignment_str = para_cfg.get("alignment", "left")
    vertical_str  = para_cfg.get("verticalAlign", "top")

    font_name = registry.font_name(ts)
    font_size = inline_ts.get("fontSize", ts.font_size)
    line_height = inline_ts.get("lineHeight", ts.line_height)
    color = registry.rl_color(inline_ts.get("color", ts.color))

    space_before = mm(para_cfg.get("spaceBefore", 0))
    space_after = mm(para_cfg.get("spaceAfter", 0))
    first_line_indent = mm(para_cfg.get("firstLineIndent", 0))
    rl_style = RLParagraphStyle(
        name="text_el",
        fontName=font_name,
        fontSize=font_size,
        leading=font_size * line_height,
        textColor=color,
        alignment=_ALIGN_MAP.get(alignment_str, TA_LEFT),
        wordWrap="CJK",
        spaceBefore=space_before,
        spaceAfter=space_after,
        firstLineIndent=first_line_indent,
    )

    # Apply text transforms
    transform = ts.text_transform
    if transform == "uppercase":
        content = content.upper()
    elif transform == "lowercase":
        content = content.lower()
    elif transform == "capitalize":
        content = content.title()

    # ── Interletra (letterSpacing) — Platypus Paragraph no la soporta, así que
    # cuando el estilo la declara se hace un layout MANUAL: wrap por palabras con
    # stringWidth + charSpace y drawString(charSpace=...) por línea. ──
    letter_spacing = getattr(ts, "letter_spacing", 0) or 0
    if letter_spacing:
        _render_text_charspace(
            canvas, content, font_name, font_size, letter_spacing,
            color, alignment_str, line_height,
            x + padding_left, y + padding_bottom, w - padding_left - padding_right,
            h - padding_top - padding_bottom, ts,
        )
        return

    # Decoraciones del ESTILO (subrayado/tachado/super-sub) → mini-XML de ReportLab.
    def _wrap_decor(markup: str) -> str:
        if getattr(ts, "underline", False):
            markup = "<u>{}</u>".format(markup)
        if getattr(ts, "strikethrough", False):
            markup = "<strike>{}</strike>".format(markup)
        if getattr(ts, "superscript", False):
            markup = "<super>{}</super>".format(markup)
        elif getattr(ts, "subscript", False):
            markup = "<sub>{}</sub>".format(markup)
        return markup

    inner_w = w - padding_left - padding_right
    inner_h = h - padding_top - padding_bottom
    if inner_w <= 0 or inner_h <= 0:
        return

    # Un PÁRRAFO por línea (\n): así el spaceBefore/spaceAfter separa los párrafos
    # y el firstLineIndent aplica a cada uno. Antes todo era UN solo Paragraph con
    # los saltos colapsados a espacios → "el texto quedaba todo seguido".
    # El primer párrafo no lleva spaceBefore (el hueco es ENTRE párrafos, no arriba
    # del bloque) → así el alto medido coincide con lo pintado y no se empuja el texto.
    first_style = RLParagraphStyle("text_el_first", parent=rl_style, spaceBefore=0)
    lines = content.split("\n")
    paras = [
        RLParagraph(_wrap_decor(_escape_xml(ln)) or "&nbsp;", first_style if i == 0 else rl_style)
        for i, ln in enumerate(lines)
    ]

    # Alto total = suma de cada párrafo + el hueco entre párrafos (ReportLab colapsa
    # el gap a max(spaceAfter_prev, spaceBefore_next); aquí ambos son iguales).
    heights = [p.wrap(inner_w, inner_h)[1] for p in paras]
    gap = max(space_before, space_after)
    total_h = sum(heights) + gap * max(0, len(paras) - 1)

    if vertical_str == _VALIGN_MIDDLE:
        v_offset = (inner_h - total_h) / 2
    elif vertical_str == _VALIGN_BOTTOM:
        v_offset = 0
    else:
        v_offset = inner_h - total_h

    v_offset = max(0, v_offset)
    frame_y = y + padding_bottom + v_offset

    frame = Frame(
        x + padding_left,
        frame_y,
        inner_w,
        min(inner_h, total_h) if total_h > 0 else inner_h,
        leftPadding=0, rightPadding=0,
        topPadding=0, bottomPadding=0,
        showBoundary=0,
    )
    frame.addFromList(paras, canvas)


def _escape_xml(text: str) -> str:
    return (text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;"))


def _render_text_charspace(
    canvas: Canvas,
    content: str,
    font_name: str,
    font_size: float,
    letter_spacing_pt: float,
    color,
    alignment_str: str,
    line_height: float,
    x: float,
    y: float,
    inner_w: float,
    inner_h: float,
    ts,
) -> None:
    """Layout manual con interletra: wrap por palabras midiendo con stringWidth +
    charSpace y dibujo con drawString(charSpace=...). Alineación left/center/right
    (justify cae a left). Dibuja también subrayado/tachado del estilo."""
    from reportlab.pdfbase.pdfmetrics import stringWidth

    if inner_w <= 0 or inner_h <= 0:
        return

    def width_of(s: str) -> float:
        return stringWidth(s, font_name, font_size) + letter_spacing_pt * max(0, len(s))

    # Wrap simple por palabras respetando saltos de línea explícitos
    lines: list[str] = []
    for raw_line in content.split("\n"):
        words = raw_line.split(" ")
        cur = ""
        for wd in words:
            candidate = wd if not cur else cur + " " + wd
            if cur and width_of(candidate) > inner_w:
                lines.append(cur)
                cur = wd
            else:
                cur = candidate
        lines.append(cur)

    leading = font_size * line_height
    canvas.saveState()
    canvas.setFont(font_name, font_size)
    canvas.setFillColor(color)
    canvas.setStrokeColor(color)

    # Primera línea arriba del cuadro (coordenadas PDF: y crece hacia arriba)
    baseline = y + inner_h - font_size
    for ln in lines:
        if baseline < y - leading:
            break  # no cabe más
        lw = width_of(ln)
        if alignment_str == "center":
            lx = x + max(0, (inner_w - lw) / 2)
        elif alignment_str == "right":
            lx = x + max(0, inner_w - lw)
        else:
            lx = x
        canvas.drawString(lx, baseline, ln, charSpace=letter_spacing_pt)
        if getattr(ts, "underline", False):
            canvas.setLineWidth(max(0.5, font_size / 14.0))
            canvas.line(lx, baseline - 1.5, lx + lw, baseline - 1.5)
        if getattr(ts, "strikethrough", False):
            canvas.setLineWidth(max(0.5, font_size / 14.0))
            mid = baseline + font_size * 0.3
            canvas.line(lx, mid, lx + lw, mid)
        baseline -= leading
    canvas.restoreState()
