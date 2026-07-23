"""
errors.py — Catálogo de errores del motor de render.

El render puede fallar por muchas causas (estilo inválido, campo faltante, fuente o
asset no encontrado, …). En vez de devolver un ``INTERNAL`` genérico al worker, se
clasifica la excepción en un código estable ``RENDER-xxx`` + un mensaje legible, que
el ``grpc_server`` envía al worker para que éste lo registre y lo muestre.

Convención: ``RENDER-000`` = sin clasificar; el resto, por causa.
"""

from __future__ import annotations


class RenderErrorCode:
    UNKNOWN = "RENDER-000"
    INVALID_STYLE_VALUE = "RENDER-001"   # un campo numérico llegó como string/"" (ej. lineHeight)
    MISSING_FIELD = "RENDER-002"         # falta una clave esperada en el template
    ASSET_NOT_FOUND = "RENDER-003"       # imagen/recurso no encontrado
    FONT_ERROR = "RENDER-004"            # problema resolviendo/cargando una fuente
    INVALID_TEMPLATE = "RENDER-005"      # el template no tiene la forma esperada


class RenderError(Exception):
    """Error de render ya clasificado. El pdf_engine puede lanzarlo directamente."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


def classify(exc: Exception) -> tuple[str, str]:
    """
    Mapea una excepción a ``(code, message)``. Si ya es un RenderError, respeta su
    código; si no, infiere por el tipo/mensaje de la excepción.
    """
    if isinstance(exc, RenderError):
        return exc.code, exc.message

    name = type(exc).__name__
    msg = str(exc)
    low = msg.lower()

    if isinstance(exc, TypeError) and ("'<='" in msg or "'>='" in msg
                                       or "'str'" in low or "unsupported operand" in low):
        return RenderErrorCode.INVALID_STYLE_VALUE, (
            "Valor de estilo inválido (se esperaba un número y llegó texto): " + msg)
    if isinstance(exc, KeyError):
        return RenderErrorCode.MISSING_FIELD, "Falta un campo esperado en el template: " + msg
    if isinstance(exc, FileNotFoundError):
        return RenderErrorCode.ASSET_NOT_FOUND, "Recurso/archivo no encontrado: " + msg
    if "font" in low:
        return RenderErrorCode.FONT_ERROR, "Problema con una fuente: " + msg
    if isinstance(exc, (AttributeError, IndexError)) and "nonetype" in low:
        return RenderErrorCode.INVALID_TEMPLATE, "El template no tiene la forma esperada: " + msg

    return RenderErrorCode.UNKNOWN, f"{name}: {msg}"
