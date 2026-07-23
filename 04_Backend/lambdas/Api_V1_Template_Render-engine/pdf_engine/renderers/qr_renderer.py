"""
qr_renderer.py
"""
from __future__ import annotations
import io
from reportlab.pdfgen.canvas import Canvas
from pdf_engine.coordinate import element_rect
from pdf_engine.normalize import DocumentContext


def render_qr(
    canvas: Canvas,
    element: dict,
    page_h_pt: float,
    ctx: DocumentContext,
) -> None:
    try:
        import qrcode
    except ImportError:
        _draw_placeholder(canvas, element, page_h_pt, "qrcode not installed")
        return

    x, y, w, h = element_rect(
        element["x"], element["y"], element["width"], element["height"], page_h_pt
    )

    value_source = element.get("valueSource", "static")
    if value_source == "static":
        value = element.get("value", "")
    else:
        var_name = element.get("value", "")
        value = str(ctx.get_var(var_name))

    if not value:
        _draw_placeholder(canvas, element, page_h_pt, "No value")
        return

    error_map = {"L": qrcode.constants.ERROR_CORRECT_L,
                 "M": qrcode.constants.ERROR_CORRECT_M,
                 "Q": qrcode.constants.ERROR_CORRECT_Q,
                 "H": qrcode.constants.ERROR_CORRECT_H}
    ec = error_map.get(element.get("errorCorrection", "M"), qrcode.constants.ERROR_CORRECT_M)

    qr = qrcode.QRCode(error_correction=ec, box_size=10, border=0)
    qr.add_data(value)
    qr.make(fit=True)

    fg = element.get("foreground", "#000000")
    bg = element.get("background", "#ffffff")
    img = qr.make_image(fill_color=fg, back_color=bg)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)

    # drawImage no acepta un BytesIO directo: hay que envolverlo en ImageReader.
    from reportlab.lib.utils import ImageReader
    canvas.drawImage(
        ImageReader(buf), x, y, width=w, height=h,
        preserveAspectRatio=True, mask="auto",
    )


def _draw_placeholder(canvas: Canvas, element: dict, page_h_pt: float, msg: str) -> None:
    x, y, w, h = element_rect(
        element["x"], element["y"], element["width"], element["height"], page_h_pt
    )
    canvas.saveState()
    canvas.setStrokeColorRGB(0.7, 0.7, 0.7)
    canvas.setFillColorRGB(0.95, 0.95, 0.95)
    canvas.rect(x, y, w, h, stroke=1, fill=1)
    canvas.setFillColorRGB(0.5, 0.5, 0.5)
    canvas.setFont("Helvetica", 6)
    canvas.drawCentredString(x + w / 2, y + h / 2, f"QR: {msg}")
    canvas.restoreState()
