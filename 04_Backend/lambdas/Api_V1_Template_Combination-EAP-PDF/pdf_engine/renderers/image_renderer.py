"""
image_renderer.py

Ajuste MailConnect: las imágenes de las plantillas viven en S3 (URL pública del
prefijo `resources/`), no en el filesystem. Si la fuente es una URL http(s), se
descarga a /tmp (con tope de tamaño y timeout, mismo patrón que el
`_link_callback` de Api_V1_Template_Render-pdf) y se dibuja desde ahí.
"""
from __future__ import annotations
import os
import tempfile
import urllib.request
from reportlab.pdfgen.canvas import Canvas
from pdf_engine.coordinate import element_rect
from pdf_engine.normalize import DocumentContext
from pdf_engine.style_registry import StyleRegistry

_IMG_MAX_BYTES = int(os.environ.get("PDF_IMG_MAX_BYTES", str(8 * 1024 * 1024)))
_IMG_TIMEOUT = int(os.environ.get("PDF_IMG_TIMEOUT", "10"))


def _fetch_remote(url: str) -> str | None:
    """Descarga una imagen http(s) a /tmp y devuelve la ruta local (None si falla)."""
    try:
        ext = os.path.splitext(url.split("?")[0])[1] or ".img"
        fd, path = tempfile.mkstemp(suffix=ext, dir="/tmp")
        os.close(fd)
        req = urllib.request.Request(url, headers={"User-Agent": "mailconnect-pdf"})
        with urllib.request.urlopen(req, timeout=_IMG_TIMEOUT) as resp:
            data = resp.read(_IMG_MAX_BYTES + 1)
        if len(data) > _IMG_MAX_BYTES:
            print("Imagen ignorada por tamaño (> {} bytes): {}".format(_IMG_MAX_BYTES, url))
            return None
        with open(path, "wb") as f:
            f.write(data)
        return path
    except Exception as e:
        print("No se pudo descargar la imagen {}: {}".format(url, e))
        return None


def render_image(
    canvas: Canvas,
    element: dict,
    page_h_pt: float,
    ctx: DocumentContext,
    registry: StyleRegistry,
    assets_base_path: str = "",
) -> None:
    x, y, w, h = element_rect(
        element["x"], element["y"], element["width"], element["height"], page_h_pt
    )

    source = element.get("source", {})
    kind = source.get("kind", "placeholder")

    if kind == "placeholder":
        _draw_placeholder(canvas, x, y, w, h)
        return

    image_path = None

    if kind == "asset":
        asset = ctx.get_asset(source.get("assetId", ""))
        if asset:
            asset_source = asset.get("source", {})
            url = asset_source.get("url", "") or asset.get("url", "")
            if url.startswith("http://") or url.startswith("https://"):
                image_path = _fetch_remote(url)
            else:
                # url is like "/images/filename.png" — resolve against base path
                image_path = os.path.join(assets_base_path, url.lstrip("/"))

    elif kind == "url":
        image_path = source.get("url", "")
        if image_path.startswith("http://") or image_path.startswith("https://"):
            image_path = _fetch_remote(image_path)

    if not image_path or not os.path.exists(image_path):
        _draw_placeholder(canvas, x, y, w, h)
        return

    fit = element.get("fit", "contain")
    rotation = element.get("rotation", 0)

    canvas.saveState()
    if rotation:
        # Rotate around the element's centre point
        cx, cy = x + w / 2, y + h / 2
        canvas.translate(cx, cy)
        canvas.rotate(rotation)
        canvas.translate(-cx, -cy)

    if fit == "contain":
        canvas.drawImage(image_path, x, y, width=w, height=h,
                         preserveAspectRatio=True, mask="auto")
    elif fit == "cover":
        canvas.drawImage(image_path, x, y, width=w, height=h,
                         preserveAspectRatio=False, mask="auto")
    else:
        canvas.drawImage(image_path, x, y, width=w, height=h, mask="auto")

    canvas.restoreState()


def _draw_placeholder(canvas: Canvas, x: float, y: float, w: float, h: float) -> None:
    canvas.saveState()
    canvas.setFillColorRGB(0.9, 0.9, 0.9)
    canvas.setStrokeColorRGB(0.7, 0.7, 0.7)
    canvas.rect(x, y, w, h, stroke=1, fill=1)
    canvas.setFillColorRGB(0.5, 0.5, 0.5)
    canvas.setFont("Helvetica", 8)
    canvas.drawCentredString(x + w / 2, y + h / 2 - 4, "[ Image ]")
    canvas.restoreState()
