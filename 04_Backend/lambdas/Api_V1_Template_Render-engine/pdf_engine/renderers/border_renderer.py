"""
border_renderer.py

Shared utility for drawing element borders onto a ReportLab canvas.
Handles three border sources (in priority order):
  1. border.styleRef  → looked up in StyleRegistry (named BorderStyle)
  2. border.mode = "unified"  → single color/width on all sides
  3. border.mode = "sides"    → each side independently configured

All measurements in the border dict are in mm; converted to pt here.
"""

from __future__ import annotations
from reportlab.pdfgen.canvas import Canvas
from pdf_engine.coordinate import mm
from pdf_engine.style_registry import StyleRegistry


def draw_border(
    canvas: Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    border: dict | None,
    registry: StyleRegistry,
    radius: float = 0,
) -> None:
    """
    Draw the border of an element.
    x, y, w, h are already in points (ReportLab bottom-left origin).
    radius is in points.
    """
    if not border:
        return

    style_ref = border.get("styleRef")
    if style_ref:
        bs = registry.border(style_ref)
        if bs:
            _draw_named_border(canvas, x, y, w, h, bs, registry, radius)
            return

    mode = border.get("mode", "none")
    if mode == "none":
        return

    if mode == "unified":
        unified = border.get("unified", {})
        if not unified.get("enabled", False):
            return
        color = registry.rl_color(unified.get("color", "#000000"))
        width = mm(unified.get("width", 1))
        r = _resolve_radius(border, radius)
        canvas.saveState()
        canvas.setStrokeColor(color)
        canvas.setLineWidth(width)
        if r > 0:
            canvas.roundRect(x, y, w, h, r, stroke=1, fill=0)
        else:
            canvas.rect(x, y, w, h, stroke=1, fill=0)
        canvas.restoreState()
        return

    if mode == "sides":
        sides = border.get("sides", {})
        _draw_sides(canvas, x, y, w, h, sides, registry)


def _draw_named_border(
    canvas: Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    bs,
    registry: StyleRegistry,
    radius: float,
) -> None:
    from pdf_engine.style_registry import ResolvedBorderStyle
    color = registry.rl_color(bs.line_color)
    width = mm(bs.line_width)
    r = mm(bs.radius_x) if bs.radius_x else radius

    # Margins shrink the border rect inward
    mx = mm(bs.margin_left)
    my = mm(bs.margin_bottom)
    mw = mm(bs.margin_right)
    mh = mm(bs.margin_top)

    bx = x + mx
    by = y + my
    bw = w - mx - mw
    bh = h - my - mh

    sides = bs.sides
    if all(s.get("enabled", True) for s in sides.values()) or not sides:
        canvas.saveState()
        canvas.setStrokeColor(color)
        canvas.setLineWidth(width)
        if r > 0:
            canvas.roundRect(bx, by, bw, bh, r, stroke=1, fill=0)
        else:
            canvas.rect(bx, by, bw, bh, stroke=1, fill=0)
        canvas.restoreState()
    else:
        _draw_named_sides(canvas, bx, by, bw, bh, bs, registry)


def _draw_sides(
    canvas: Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    sides: dict,
    registry: StyleRegistry,
) -> None:
    """Draw each side individually from inline border.sides config."""
    _side_line(canvas, sides.get("top", {}),    x,     y+h,  x+w,  y+h,  registry)
    _side_line(canvas, sides.get("bottom", {}), x,     y,    x+w,  y,    registry)
    _side_line(canvas, sides.get("left", {}),   x,     y,    x,    y+h,  registry)
    _side_line(canvas, sides.get("right", {}),  x+w,   y,    x+w,  y+h,  registry)


def _draw_named_sides(
    canvas: Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    bs,
    registry: StyleRegistry,
) -> None:
    default_color = registry.rl_color(bs.line_color)
    default_width = mm(bs.line_width)

    def _line(side_key: str, x1, y1, x2, y2):
        side = bs.sides.get(side_key, {})
        if not side.get("enabled", True):
            return
        sc = registry.rl_color(side.get("lineColor") or bs.line_color)
        sw = mm(side.get("lineWidth") or bs.line_width)
        canvas.saveState()
        canvas.setStrokeColor(sc)
        canvas.setLineWidth(sw)
        canvas.line(x1, y1, x2, y2)
        canvas.restoreState()

    _line("top",    x,   y+h, x+w, y+h)
    _line("bottom", x,   y,   x+w, y)
    _line("left",   x,   y,   x,   y+h)
    _line("right",  x+w, y,   x+w, y+h)


def _side_line(
    canvas: Canvas,
    side: dict,
    x1: float, y1: float,
    x2: float, y2: float,
    registry: StyleRegistry,
) -> None:
    if not side.get("enabled", False):
        return
    color = registry.rl_color(side.get("color", "#000000"))
    width = mm(side.get("width", 1))
    canvas.saveState()
    canvas.setStrokeColor(color)
    canvas.setLineWidth(width)
    canvas.line(x1, y1, x2, y2)
    canvas.restoreState()


def _resolve_radius(border: dict, default: float) -> float:
    radius_cfg = border.get("radius", {})
    unified = radius_cfg.get("unified", 0)
    return mm(unified) if unified else default
