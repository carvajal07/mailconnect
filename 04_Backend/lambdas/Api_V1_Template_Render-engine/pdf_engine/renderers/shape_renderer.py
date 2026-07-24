"""
shape_renderer.py  —  ellipse, rectangle, triangle

Soporta relleno sólido (con opacidad), degradado lineal/radial (clip a la forma
+ canvas.linearGradient/radialGradient), borde unificado o por styleRef, y
ROTACIÓN del elemento (alrededor de su centro).
"""
from __future__ import annotations
import math
from reportlab.pdfgen.canvas import Canvas
from pdf_engine.coordinate import element_rect, mm
from pdf_engine.style_registry import StyleRegistry


def _num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def render_shape(canvas: Canvas, element: dict, page_h_pt: float, registry: StyleRegistry) -> None:
    shape = element.get("shape", "rectangle")
    x, y, w, h = element_rect(
        element["x"], element["y"], element["width"], element["height"], page_h_pt
    )
    border = element.get("border")
    fill = element.get("fill")
    is_gradient = bool(fill and fill.get("type") == "gradient" and (fill.get("gradient") or {}).get("stops"))

    # Rotación del editor: en pantalla (Y hacia abajo) el ángulo es horario; el PDF
    # tiene Y hacia arriba → `canvas.rotate(-rot)` reproduce el mismo giro visual.
    rot = _num(element.get("rotation"))

    canvas.saveState()
    if rot:
        cx, cy = x + w / 2.0, y + h / 2.0
        canvas.translate(cx, cy)
        canvas.rotate(-rot)
        canvas.translate(-cx, -cy)

    if is_gradient:
        # 1) degradado recortado a la forma; 2) borde encima sin relleno.
        _paint_gradient(canvas, shape, x, y, w, h, fill, border, registry)
        canvas.saveState()
        canvas.setFillColorRGB(1, 1, 1, 0)  # sin relleno para el trazo
        _apply_border(canvas, border, registry)
        _draw_shape_path(canvas, shape, x, y, w, h, border, fill_flag=0)
        canvas.restoreState()
    else:
        canvas.saveState()
        _apply_fill(canvas, fill, registry)
        _apply_border(canvas, border, registry)
        _draw_shape_path(canvas, shape, x, y, w, h, border, fill_flag=1)
        canvas.restoreState()

    canvas.restoreState()


def _radius_pt(border: dict | None) -> float:
    if border and border.get("radius"):
        return mm(border["radius"].get("unified", 0))
    return 0.0


def _draw_shape_path(canvas: Canvas, shape: str, x, y, w, h, border: dict | None, fill_flag: int) -> None:
    if shape == "rectangle":
        radius = _radius_pt(border)
        if radius > 0:
            canvas.roundRect(x, y, w, h, radius, stroke=1, fill=fill_flag)
        else:
            canvas.rect(x, y, w, h, stroke=1, fill=fill_flag)
    elif shape == "ellipse":
        canvas.ellipse(x, y, x + w, y + h, stroke=1, fill=fill_flag)
    elif shape == "triangle":
        _draw_triangle(canvas, x, y, w, h, fill_flag)


def _draw_triangle(canvas: Canvas, x, y, w, h, fill_flag: int = 1) -> None:
    # Upward-pointing triangle
    path = canvas.beginPath()
    path.moveTo(x + w / 2, y + h)   # apex
    path.lineTo(x, y)               # bottom-left
    path.lineTo(x + w, y)           # bottom-right
    path.close()
    canvas.drawPath(path, stroke=1, fill=fill_flag)


def _shape_clip_path(canvas: Canvas, shape: str, x, y, w, h, border: dict | None):
    """Path de la forma para usar como región de clip del degradado.

    ⚠️ `PDFPathObject.ellipse(x, y, width, height)` toma ANCHO/ALTO, no las dos
    esquinas — pasar (x, y, x+w, y+h) creaba un clip GIGANTE (la elipse del
    degradado radial se salía por toda la hoja). Se usa (x, y, w, h). El
    rectángulo con radio recorta con esquinas redondeadas para que el relleno
    NO se salga del borde redondeado.
    """
    path = canvas.beginPath()
    if shape == "ellipse":
        path.ellipse(x, y, w, h)
    elif shape == "triangle":
        path.moveTo(x + w / 2, y + h)
        path.lineTo(x, y)
        path.lineTo(x + w, y)
        path.close()
    else:
        radius = _radius_pt(border)
        if radius > 0:
            path.roundRect(x, y, w, h, radius)
        else:
            path.rect(x, y, w, h)
    return path


def _paint_gradient(canvas: Canvas, shape: str, x, y, w, h,
                    fill: dict, border: dict | None, registry: StyleRegistry) -> None:
    grad = fill.get("gradient") or {}
    stops = grad.get("stops") or []
    if len(stops) < 2:
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
        clip = _shape_clip_path(canvas, shape, x, y, w, h, border)
        canvas.clipPath(clip, stroke=0, fill=0)
        if grad.get("type") == "radial":
            cx = x + w * ((grad.get("cx", 50) or 50) / 100.0)
            # cy% viene en coordenadas de pantalla (Y hacia abajo) → se invierte.
            cy = y + h * (1 - ((grad.get("cy", 50) or 50) / 100.0))
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
        canvas.restoreState()
        canvas.saveState()
        canvas.setFillColor(colors[0])
        canvas.setStrokeColorRGB(0, 0, 0, 0)
        _draw_shape_path(canvas, shape, x, y, w, h, border, fill_flag=1)
    canvas.restoreState()


def _apply_fill(canvas: Canvas, fill: dict | None, registry: StyleRegistry) -> None:
    """Fija el color de relleno en el estado ACTUAL (el llamador maneja save/restore)."""
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
