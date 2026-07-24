"""
Coordinate utilities.

The templateJson stores all measurements in millimetres (mm).
ReportLab uses points (pt): 1 pt = 1/72 inch = 0.352778 mm → 1 mm = 2.8346 pt.

ReportLab's canvas Y-axis starts at the BOTTOM of the page.
The templateJson Y-axis starts at the TOP of the page.
All conversions must flip Y: pdf_y = page_height_pt - json_y_pt - element_height_pt
"""

MM_TO_PT: float = 2.8346456692913385


def mm(value: float) -> float:
    """Convert millimetres to points."""
    return value * MM_TO_PT


def pt(value: float) -> float:
    """Convert points to millimetres (inverse, for debugging)."""
    return value / MM_TO_PT


def page_height_pt(height_mm: float) -> float:
    return mm(height_mm)


def page_width_pt(width_mm: float) -> float:
    return mm(width_mm)


def element_rect(
    x_mm: float,
    y_mm: float,
    width_mm: float,
    height_mm: float,
    page_h_pt: float,
) -> tuple[float, float, float, float]:
    """
    Convert element position from JSON (mm, top-left origin) to ReportLab
    (pt, bottom-left origin).

    Returns (x, y, width, height) in points, where y is the BOTTOM-LEFT corner
    of the element in ReportLab coordinates.
    """
    x = mm(x_mm)
    w = mm(width_mm)
    h = mm(height_mm)
    y = page_h_pt - mm(y_mm) - h
    return x, y, w, h


def apply_margin(
    page_w_pt: float,
    page_h_pt: float,
    margin_top_mm: float,
    margin_right_mm: float,
    margin_bottom_mm: float,
    margin_left_mm: float,
) -> tuple[float, float, float, float]:
    """
    Returns the usable content rectangle (x, y, width, height) in points
    after applying page margins.
    """
    x = mm(margin_left_mm)
    y = mm(margin_bottom_mm)
    w = page_w_pt - mm(margin_left_mm) - mm(margin_right_mm)
    h = page_h_pt - mm(margin_top_mm) - mm(margin_bottom_mm)
    return x, y, w, h
