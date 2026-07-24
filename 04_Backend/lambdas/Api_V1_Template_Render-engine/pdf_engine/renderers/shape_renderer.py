"""
shape_renderer.py  —  ellipse, rectangle, triangle

Soporta relleno sólido (con opacidad), degradado lineal/radial (clip a la forma
+ canvas.linearGradient/radialGradient) y borde unificado o por styleRef.
"""
from __future__ import annotations
import math
from reportlab.pdfgen.canvas import Canvas
from pdf_engine.coordinate import element_rect, mm
from pdf_engine.style_registry import StyleRegistry


def render_shape(canvas: Canvas, element: dict, page_h_pt: float, registry: StyleRegistry) -> None:
    shape = element.get("shape", "rectangle")
    x, y, w, h = element_rect(
        element["x"], element["y"], element["width"], element["height"], page_h_pt
    )

    fill = element.get("fill")
    is_gradient = bool(fill and fill.get("type") == "gradient" and (fill.get("gradient") or {}).get("stops"))

    if is_gradient:
        # 1) pinta el degradado recortado a la forma; 2) traza el borde sin fill.
        _paint_gradient(canvas, shape, x, y, w, h, fill, element.get("border"), registry)
        canvas.saveState()
        canvas.setFillColorRGB(1, 1, 1, 0)  # sin relleno para el trazo
        _apply_border(canvas, element.get("border"), registry)
        _draw_shape_path(canvas, shape, x, y, w, h, element.get("border"), fill_flag=0)
        canvas.restoreState()
        return

    _apply_fill(canvas, fill, registry)
    _apply_border(canvas, element.get("border"), registry)
    _draw_shape_path(canvas, shape, x, y, w, h, element.get("border"), fill_flag=1)
    canvas.restoreState()


def _draw_shape_path(canvas: Canvas, shape: str, x, y, w, h, border: dict | None, fill_flag: int) -> None:
    if shape == "rectangle":
        _draw_rectangle(canvas, x, y, w, h, border, fill_flag)
    elif shape == "ellipse":
        canvas.ellipse(x, y, x + w, y + h, stroke=1, fill=fill_flag)
    elif shape == "triangle":
        _draw_triangle(canvas, x, y, w, h, fill_flag)


def _draw_rectangle(canvas: Canvas, x, y, w, h, border: dict | None, fill_flag: int = 1) -> None:
    radius = 0
    if border and border.get("radius"):
        radius = mm(border["radius"].get("unified", 0))
    if radius > 0:
        canvas.roundRect(x, y, w, h, radius, stroke=1, fill=fill_flag)
    else:
        canvas.rect(x, y, w, h, stroke=1, fill=fill_flag)


def _draw_triangle(canvas: Canvas, x, y, w, h, fill_flag: int = 1) -> None:
    # Upward-pointing triangle
    path = canvas.beginPath()
    path.moveTo(x + w / 2, y + h)   # apex
    path.lineTo(x, y)               # bottom-left
    path.lineTo(x + w, y)           # bottom-right
    path.close()
    canvas.drawPath(path, stroke=1, fill=fill_flag)


def _shape_clip_path(canvas: Canvas, shape: str, x, y, w, h):
    """Path de la forma para usar como región de clip del degradado."""
    path = canvas.beginPath()
    if shape == "ellipse":
        path.ellipse(x, y, x + w, y + h)
    elif shape == "triangle":
        path.moveTo(x + w / 2, y + h)
        path.lineTo(x, y)
        path.lineTo(x + w, y)
        path.close()
    else:
        path.rect(x, y, w, h)
    return path


def _paint_gradient(canvas: Canvas, shape: str, x, y, w, h,
                    fill: dict, border: dict | None, registry: StyleRegistry) -> None:
    grad = fill.get("gradient") or {}
    stops = grad.get("stops") or []
    if len(stops) < 2:
        # degradado degenerado → sólido con el primer color
        color = registry.rl_color((stops[0].get("color") if stops else "#ffffff") or "#ffffff",
                                  fill.get("opacity", 1.0))
        canvas.saveState()
        canvas.setFillColor(color)
        canvas.setStrokeColorRGB(0, 0, 0, 0)
        _draw_shape_path(canvas, shape, x, y, w, h, border, fill_flag=1)
        canvas.restoreState()
        return

    ordered = sorted(stops, key=lambda s: s.get("offset", 0))
    colors = [registry.rl_color(s.get("color", "#000000")) for s in ordered]
    positions = [max(0.0, min(1.0, (s.get("offset", 0) or 0) / 100.0)) for s in ordered]
    # ReportLab exige posiciones estrictamente crecientes con extremos 0 y 1
    positions[0] = 0.0
    positions[-1] = 1.0
    for i in range(1, len(positions)):
        if positions[i] <= positions[i - 1]:
            positions[i] = min(1.0, positions[i - 1] + 0.001)

    opacity = fill.get("opacity", 1.0)
    canvas.saveState()
    try:
        if opacity is not None and opacity < 1:
            canvas.setFillAlpha(float(opacity))
        clip = _shape_clip_path(canvas, shape, x, y, w, h)
        canvas.clipPath(clip, stroke=0, fill=0)
        if grad.get("type") == "radial":
            cx = x + w * ((grad.get("cx", 50) or 50) / 100.0)
            cy = y + h * (1 - ((grad.get("cy", 50) or 50) / 100.0))  # cy% viene en coords "pantalla"
            radius = max(w, h) * 0.75
            canvas.radialGradient(cx, cy, radius, colors, positions, extend=True)
        else:
            # Ángulo del Diseñador: 0° = ↑, 90° = →. En PDF la Y crece hacia arriba.
            ang = math.radians((grad.get("angle", 180) or 0) - 90)
            cx, cy = x + w / 2, y + h / 2
            half = abs(math.cos(ang)) * (w / 2) + abs(math.sin(ang)) * (h / 2)
            dx, dy = math.cos(ang) * half, -math.sin(ang) * half
            canvas.linearGradient(cx - dx, cy - dy, cx + dx, cy + dy, colors, positions, extend=True)
    except Exception:
        # Fail-safe: si el gradiente no está disponible en esta versión de
        # ReportLab, cae a un sólido con el primer color del degradado.
        canvas.restoreState()
        canvas.saveState()
        canvas.setFillColor(colors[0])
        canvas.setStrokeColorRGB(0, 0, 0, 0)
        _draw_shape_path(canvas, shape, x, y, w, h, border, fill_flag=1)
    canvas.restoreState()


def _apply_fill(canvas: Canvas, fill: dict | None, registry: StyleRegistry) -> None:
    canvas.saveState()
    if not fill or fill.get("type") == "none":
        canvas.setFillColorRGB(1, 1, 1, 0)  # transparent
        return
    if fill.get("type") == "solid":
        color = registry.rl_color(fill.get("color", "#ffffff"), fill.get("opacity", 1.0))
        canvas.setFillColor(color)


def _apply_border(canvas: Canvas, border: dict | None, registry: StyleRegistry) -> None:
    if not border:
        canvas.setStrokeColorRGB(0, 0, 0, 0)  # no stroke
        canvas.setLineWidth(0)
        return

    style_ref = border.get("styleRef")
    if style_ref:
        bs = registry.border(style_ref)
        if bs:
            canvas.setStrokeColor(registry.rl_color(bs.line_color))
            canvas.setLineWidth(mm(bs.line_width))
            return

    mode = border.get("mode", "none")
    if mode == "unified":
        unified = border.get("unified", {})
        if unified.get("enabled"):
            canvas.setStrokeColor(registry.rl_color(unified.get("color", "#000000")))
            canvas.setLineWidth(mm(unified.get("width", 1)))
            return

    canvas.setStrokeColorRGB(0, 0, 0, 0)
    canvas.setLineWidth(0)
