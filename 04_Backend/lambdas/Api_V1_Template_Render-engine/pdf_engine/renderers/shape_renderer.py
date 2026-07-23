"""
shape_renderer.py  —  ellipse, rectangle, triangle
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

    _apply_fill(canvas, element.get("fill"), registry)
    _apply_border(canvas, element.get("border"), registry)

    if shape == "rectangle":
        _draw_rectangle(canvas, x, y, w, h, element.get("border"))
    elif shape == "ellipse":
        _draw_ellipse(canvas, x, y, w, h)
    elif shape == "triangle":
        _draw_triangle(canvas, x, y, w, h)

    canvas.restoreState()


def _draw_rectangle(canvas: Canvas, x, y, w, h, border: dict | None) -> None:
    radius = 0
    if border and border.get("radius"):
        radius = mm(border["radius"].get("unified", 0))
    if radius > 0:
        canvas.roundRect(x, y, w, h, radius, stroke=1, fill=1)
    else:
        canvas.rect(x, y, w, h, stroke=1, fill=1)


def _draw_ellipse(canvas: Canvas, x, y, w, h) -> None:
    canvas.ellipse(x, y, x + w, y + h, stroke=1, fill=1)


def _draw_triangle(canvas: Canvas, x, y, w, h) -> None:
    # Upward-pointing triangle
    path = canvas.beginPath()
    path.moveTo(x + w / 2, y + h)   # apex
    path.lineTo(x, y)               # bottom-left
    path.lineTo(x + w, y)           # bottom-right
    path.close()
    canvas.drawPath(path, stroke=1, fill=1)


def _apply_fill(canvas: Canvas, fill: dict | None, registry: StyleRegistry) -> None:
    canvas.saveState()
    if not fill or fill.get("type") == "none":
        canvas.setFillColorRGB(1, 1, 1, 0)  # transparent
        return
    if fill.get("type") == "solid":
        color = registry.rl_color(fill.get("color", "#ffffff"), fill.get("opacity", 1.0))
        canvas.setFillColor(color)
    # gradient fill: ReportLab supports linear gradients via canvas.linearGradient
    # — implement when needed


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
