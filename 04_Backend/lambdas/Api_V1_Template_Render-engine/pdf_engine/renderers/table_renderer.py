"""
table_renderer.py

Renders a `table` element using ReportLab's Table/TableStyle platypus widget.

Data sources:
  - element.dataSource (string): variable name in ctx.data pointing to list[dict]
    Each dict item is one body row; column.id or column.label used as field key.
  - element.body.rows (list): explicit row/cell data defined in the template.
  - element.header.rows: explicit header rows (falls back to column labels).

Column widths come from columns[].width + columns[].widthUnit ("mm" or "%").
"""

from __future__ import annotations
from reportlab.platypus import Table, TableStyle, Frame, KeepInFrame
from reportlab.platypus import Paragraph as RLParagraph
from reportlab.lib.styles import ParagraphStyle as RLParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.lib import colors
from reportlab.pdfgen.canvas import Canvas

from pdf_engine.coordinate import element_rect, mm
from pdf_engine.normalize import DocumentContext
from pdf_engine.style_registry import StyleRegistry
from pdf_engine.renderers.border_renderer import draw_border

_ALIGN_MAP = {"left": TA_LEFT, "center": TA_CENTER, "right": TA_RIGHT}


def render_table(
    canvas: Canvas,
    element: dict,
    page_h_pt: float,
    ctx: DocumentContext,
    registry: StyleRegistry,
) -> None:
    x, y, w, h = element_rect(
        element["x"], element["y"], element["width"], element["height"], page_h_pt
    )

    columns = element.get("columns", [])
    if not columns:
        return

    col_widths = _resolve_col_widths(columns, w)
    header_cfg = element.get("header", {})
    body_cfg   = element.get("body", {})
    footer_cfg = element.get("footer", {})

    # ── Collect rows ──────────────────────────────────────────────────────────
    all_rows: list[list] = []
    style_cmds: list[tuple] = []
    row_idx = 0

    # Header
    if header_cfg.get("enabled", True):
        header_rows = _build_header_rows(header_cfg, columns, registry)
        for hr in header_rows:
            all_rows.append(hr)
            style_cmds += _header_style_cmds(row_idx, len(columns), registry)
            row_idx += 1

    # Body — from dataSource variable or explicit rows
    body_rows = _build_body_rows(body_cfg, element.get("dataSource"), columns, ctx, registry)
    for br in body_rows:
        all_rows.append(br)
        style_cmds += _body_style_cmds(row_idx, len(columns))
        row_idx += 1

    # Footer
    if footer_cfg.get("enabled", False):
        footer_rows = _build_footer_rows(footer_cfg, columns, registry)
        for fr in footer_rows:
            all_rows.append(fr)
            style_cmds += _header_style_cmds(row_idx, len(columns), registry)
            row_idx += 1

    if not all_rows:
        _draw_empty_placeholder(canvas, x, y, w, h, columns)
        return

    # ── Table borders ─────────────────────────────────────────────────────────
    table_border = element.get("tableBorder", {})
    cell_border  = element.get("cellBorder", {})
    style_cmds += _border_style_cmds(table_border, cell_border, len(all_rows), len(columns))

    # ── Alternate row fill ────────────────────────────────────────────────────
    alt_fill = element.get("alternateRowFill")
    if alt_fill and alt_fill.get("type") == "solid":
        alt_color = registry.rl_color(alt_fill.get("color", "#f9fafb"), alt_fill.get("opacity", 1.0))
        header_offset = 1 if header_cfg.get("enabled", True) else 0
        for i in range(header_offset, len(all_rows), 2):
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), alt_color))

    tbl = Table(all_rows, colWidths=col_widths, repeatRows=1 if header_cfg.get("enabled") else 0)
    tbl.setStyle(TableStyle(style_cmds))

    frame = Frame(x, y, w, h, leftPadding=0, rightPadding=0,
                  topPadding=0, bottomPadding=0, showBoundary=0)
    frame.addFromList([KeepInFrame(w, h, [tbl], mode="shrink")], canvas)

    draw_border(canvas, x, y, w, h, element.get("border"), registry)


# ── Row builders ──────────────────────────────────────────────────────────────

def _build_header_rows(
    header_cfg: dict,
    columns: list[dict],
    registry: StyleRegistry,
) -> list[list]:
    explicit = header_cfg.get("rows", [])
    if explicit:
        return [_cells_from_row(row, registry) for row in explicit]
    # Default: column labels
    style = _cell_style(registry, bold=True)
    return [[RLParagraph(col.get("label", ""), style) for col in columns]]


def _build_body_rows(
    body_cfg: dict,
    data_source: str | None,
    columns: list[dict],
    ctx: DocumentContext,
    registry: StyleRegistry,
) -> list[list]:
    style = _cell_style(registry)

    # Explicit rows defined in the template
    explicit = body_cfg.get("rows", [])
    if explicit:
        return [_cells_from_row(row, registry) for row in explicit]

    # Dynamic rows from data context
    if data_source:
        data = ctx.get_var(data_source)
        if isinstance(data, list):
            rows = []
            for item in data:
                if not isinstance(item, dict):
                    item = {"value": str(item)}
                row = []
                for col in columns:
                    # Try col.id first, then col.label as field key
                    field_key = col.get("id", col.get("label", ""))
                    label_key = col.get("label", "")
                    value = item.get(field_key) or item.get(label_key) or item.get(label_key.lower(), "")
                    row.append(RLParagraph(str(value) if value is not None else "", style))
                rows.append(row)
            return rows

    return []


def _build_footer_rows(
    footer_cfg: dict,
    columns: list[dict],
    registry: StyleRegistry,
) -> list[list]:
    explicit = footer_cfg.get("rows", [])
    if explicit:
        return [_cells_from_row(row, registry) for row in explicit]
    return []


def _cells_from_row(row: dict | list, registry: StyleRegistry) -> list:
    style = _cell_style(registry)
    cells = row if isinstance(row, list) else row.get("cells", [])
    result = []
    for cell in cells:
        if isinstance(cell, str):
            result.append(RLParagraph(_esc(cell), style))
        elif isinstance(cell, dict):
            content = cell.get("content", cell.get("value", ""))
            result.append(RLParagraph(_esc(str(content)), style))
        else:
            result.append(RLParagraph("", style))
    return result


# ── Column widths ─────────────────────────────────────────────────────────────

def _resolve_col_widths(columns: list[dict], total_w_pt: float) -> list[float]:
    widths = []
    for col in columns:
        if "widthRatio" in col:
            # Front-end format: widthRatio is a 0-1 proportion of total width
            widths.append(total_w_pt * float(col["widthRatio"]))
        else:
            unit = col.get("widthUnit", "mm")
            val  = col.get("width", 20)
            if unit == "%":
                widths.append(total_w_pt * val / 100)
            else:
                widths.append(mm(val))

    # If widths don't sum to total, scale proportionally
    total = sum(widths)
    if total > 0 and abs(total - total_w_pt) > 1:
        factor = total_w_pt / total
        widths = [w * factor for w in widths]
    return widths


# ── TableStyle commands ───────────────────────────────────────────────────────

def _header_style_cmds(row: int, n_cols: int, registry: StyleRegistry) -> list[tuple]:
    return [
        ("BACKGROUND",  (0, row), (n_cols-1, row), colors.HexColor("#f3f4f6")),
        ("FONTNAME",    (0, row), (n_cols-1, row), "Helvetica-Bold"),
        ("FONTSIZE",    (0, row), (n_cols-1, row), 9),
        ("BOTTOMPADDING", (0, row), (n_cols-1, row), 4),
        ("TOPPADDING",    (0, row), (n_cols-1, row), 4),
    ]


def _body_style_cmds(row: int, n_cols: int) -> list[tuple]:
    return [
        ("FONTNAME",  (0, row), (n_cols-1, row), "Helvetica"),
        ("FONTSIZE",  (0, row), (n_cols-1, row), 8),
        ("BOTTOMPADDING", (0, row), (n_cols-1, row), 3),
        ("TOPPADDING",    (0, row), (n_cols-1, row), 3),
        ("LEFTPADDING",   (0, row), (n_cols-1, row), 4),
        ("RIGHTPADDING",  (0, row), (n_cols-1, row), 4),
    ]


def _border_style_cmds(
    table_border: dict,
    cell_border: dict,
    n_rows: int,
    n_cols: int,
) -> list[tuple]:
    cmds = []

    # Outer table border
    tb_mode = table_border.get("mode", "unified")
    if tb_mode == "unified":
        u = table_border.get("unified", {})
        if u.get("enabled", True):
            c = colors.HexColor(u.get("color", "#d1d5db"))
            w = u.get("width", 1) * 0.5
            cmds += [
                ("BOX", (0, 0), (n_cols-1, n_rows-1), w, c),
            ]

    # Inner cell borders
    cb_mode = cell_border.get("mode", "unified")
    if cb_mode == "unified":
        u = cell_border.get("unified", {})
        if u.get("enabled", True):
            c = colors.HexColor(u.get("color", "#e5e7eb"))
            w = u.get("width", 0.5) * 0.5
            cmds += [
                ("INNERGRID", (0, 0), (n_cols-1, n_rows-1), w, c),
            ]

    return cmds


# ── Helpers ───────────────────────────────────────────────────────────────────

def _cell_style(registry: StyleRegistry, bold: bool = False) -> RLParagraphStyle:
    return RLParagraphStyle(
        name="cell_bold" if bold else "cell",
        fontName="Helvetica-Bold" if bold else "Helvetica",
        fontSize=9 if bold else 8,
        leading=12,
        wordWrap="CJK",
    )


def _draw_empty_placeholder(
    canvas: Canvas,
    x: float, y: float, w: float, h: float,
    columns: list[dict],
) -> None:
    canvas.saveState()
    canvas.setStrokeColorRGB(0.8, 0.8, 0.8)
    canvas.setFillColorRGB(0.97, 0.97, 0.97)
    canvas.rect(x, y, w, h, stroke=1, fill=1)
    canvas.setFillColorRGB(0.6, 0.6, 0.6)
    canvas.setFont("Helvetica", 7)
    col_names = ", ".join(c.get("label", "") for c in columns[:4])
    canvas.drawCentredString(x + w/2, y + h/2, f"Tabla: {col_names}")
    canvas.restoreState()


def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
