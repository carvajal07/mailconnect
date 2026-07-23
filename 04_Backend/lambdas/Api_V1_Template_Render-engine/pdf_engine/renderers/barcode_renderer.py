"""
barcode_renderer.py  —  CODE128, EAN13, EAN8, CODE39, ITF
"""
from __future__ import annotations
import io
from reportlab.pdfgen.canvas import Canvas
from pdf_engine.coordinate import element_rect
from pdf_engine.normalize import DocumentContext


_SYMBOLOGY_MAP = {
    "CODE128": "code128",
    "CODE39":  "code39",
    "EAN13":   "ean13",
    "EAN8":    "ean8",
    "ITF":     "itf",
}


def render_barcode(
    canvas: Canvas,
    element: dict,
    page_h_pt: float,
    ctx: DocumentContext,
) -> None:
    try:
        import barcode as python_barcode
        from barcode.writer import ImageWriter
    except ImportError:
        _draw_placeholder(canvas, element, page_h_pt, "python-barcode not installed")
        return

    x, y, w, h = element_rect(
        element["x"], element["y"], element["width"], element["height"], page_h_pt
    )

    value_source = element.get("valueSource", "static")
    value = element.get("value", "123456789")
    if value_source != "static":
        value = str(ctx.get_var(value))

    symbology_key = _SYMBOLOGY_MAP.get(element.get("symbology", "CODE128"), "code128")

    try:
        BarcodeClass = python_barcode.get_barcode_class(symbology_key)
        bc = BarcodeClass(value, writer=ImageWriter())
        buf = io.BytesIO()
        bc.write(buf, options={
            "write_text": element.get("showText", True),
            "foreground": element.get("foreground", "#000000").lstrip("#"),
            "background": element.get("background", "#ffffff").lstrip("#"),
        })
        buf.seek(0)
        # drawImage no acepta un BytesIO directo: hay que envolverlo en ImageReader.
        from reportlab.lib.utils import ImageReader
        canvas.drawImage(ImageReader(buf), x, y, width=w, height=h,
                         preserveAspectRatio=True, mask="auto")
    except Exception as exc:
        _draw_placeholder(canvas, element, page_h_pt, str(exc))


def _draw_placeholder(canvas: Canvas, element: dict, page_h_pt: float, msg: str) -> None:
    x, y, w, h = element_rect(
        element["x"], element["y"], element["width"], element["height"], page_h_pt
    )
    canvas.saveState()
    canvas.setStrokeColorRGB(0.7, 0.7, 0.7)
    canvas.setFillColorRGB(0.95, 0.95, 0.95)
    canvas.rect(x, y, w, h, stroke=1, fill=1)
    canvas.setFillColorRGB(0.4, 0.4, 0.4)
    canvas.setFont("Helvetica", 6)
    canvas.drawCentredString(x + w / 2, y + h / 2, f"BC: {msg}")
    canvas.restoreState()
