"""
contentarea_renderer.py

Renders a contentArea element onto the canvas.
Resolves variables, evaluates area-tag conditions, expands inline sub-areas,
and lays out paragraphs using ReportLab's Paragraph + Frame platypus flow.
"""
from __future__ import annotations
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph as RLParagraph, Frame, KeepInFrame, ListItem, ListFlowable
from reportlab.lib.styles import ParagraphStyle as RLParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY

from reportlab.platypus import Table, TableStyle
from reportlab.lib import colors

from pdf_engine.coordinate import element_rect, mm
from pdf_engine.normalize import DocumentContext
from pdf_engine.style_registry import StyleRegistry, ResolvedTextStyle
from pdf_engine.html_parser import parse_content, Paragraph, TextRun, InlineStyle
from pdf_engine.variable_resolver import resolve_paragraphs
from pdf_engine.area_resolver import resolve_area, get_effective_content
from pdf_engine.renderers.border_renderer import draw_border

_ALIGN_MAP = {
    "left":    TA_LEFT,
    "center":  TA_CENTER,
    "right":   TA_RIGHT,
    "justify": TA_JUSTIFY,
}


def render_contentarea(
    canvas: Canvas,
    element: dict,
    page_h_pt: float,
    ctx: DocumentContext,
    registry: StyleRegistry,
    page_vars: dict | None = None,
) -> None:
    x, y, w, h = element_rect(
        element["x"], element["y"], element["width"], element["height"], page_h_pt
    )

    # Background fill
    fill = element.get("fill")
    if fill and fill.get("type") == "solid":
        color = registry.rl_color(fill.get("color", "#ffffff"), fill.get("opacity", 1.0))
        canvas.saveState()
        canvas.setFillColor(color)
        canvas.rect(x, y, w, h, stroke=0, fill=1)
        canvas.restoreState()

    area_id = element.get("areaRef", "")
    area = resolve_area(area_id, ctx)
    if area is None:
        draw_border(canvas, x, y, w, h, element.get("border"), registry)
        return

    default_ts_id = area.get("defaultTextStyleId", "ts_default")
    default_ts = registry.text(default_ts_id)

    story = _build_story(area, default_ts, ctx, registry, page_vars, available_width=w)

    if story:
        frame = Frame(x, y, w, h, leftPadding=0, rightPadding=0,
                      topPadding=0, bottomPadding=0, showBoundary=0)
        frame.addFromList([KeepInFrame(w, h, story, mode="shrink")], canvas)

    draw_border(canvas, x, y, w, h, element.get("border"), registry)


# ── Story builder ─────────────────────────────────────────────────────────────

def _build_story(
    area: dict,
    default_ts: ResolvedTextStyle,
    ctx: DocumentContext,
    registry: StyleRegistry,
    page_vars: dict | None,
    available_width: float = 0,
    extra_area_lookup: dict | None = None,
) -> list:
    """
    Build a flat list of ReportLab flowables from the area's HTML content,
    expanding inline area-tag and element-tag references recursively.
    extra_area_lookup: local sub-areas not in ctx.area_index (e.g. cell flow children).
    """
    html = area.get("content", "")
    paragraphs = parse_content(html)
    resolve_paragraphs(paragraphs, ctx.data, page_vars)

    # Build local lookup from area.children so element-tag sub-areas resolve too
    local_lookup = extra_area_lookup or {}
    for child in area.get("children", []):
        local_lookup = {**local_lookup, child["id"]: child}

    story = []
    for para in paragraphs:
        flowables = _para_to_flowables(
            para, default_ts, ctx, registry, page_vars,
            area_elements=area.get("elements", []),
            available_width=available_width,
            extra_area_lookup=local_lookup,
        )
        story.extend(flowables)
    return story


def _para_to_flowables(
    para: Paragraph,
    default_ts: ResolvedTextStyle,
    ctx: DocumentContext,
    registry: StyleRegistry,
    page_vars: dict | None,
    area_elements: list | None = None,
    available_width: float = 0,
    extra_area_lookup: dict | None = None,
) -> list:
    """
    Convert one Paragraph into ReportLab flowables.

    - area-tag runs are expanded INLINE: their text runs are merged into the
      current paragraph so the output matches the canvas (no spurious line breaks).
    - element-tag runs (embedded tables) force a paragraph break; the table is
      emitted as a block flowable between text segments.
    """
    rl_style = _make_rl_style(default_ts, registry, para)
    result: list = []
    current_runs: list[TextRun] = []

    def flush():
        """Emit accumulated runs as one RLParagraph (if non-empty)."""
        xml = _runs_to_rl_xml(current_runs, default_ts, registry)
        current_runs.clear()
        if xml.strip():
            if para.list_item:
                result.append(_make_list_item(xml, rl_style, para))
            else:
                result.append(RLParagraph(xml, rl_style))

    for run in para.runs:
        if run.is_area_ref:
            # Expand inline — no paragraph break
            inline = _expand_area_inline(
                run.area_id, ctx, registry, page_vars,
                area_elements, available_width, extra_area_lookup,
            )
            current_runs.extend(inline)

        elif run.is_element_ref and run.element_type == "table":
            # Tables are block-level: flush text, then emit table
            flush()
            el = next(
                (e for e in (area_elements or []) if e.get("id") == run.element_id),
                None,
            )
            if el:
                tbl = _build_embedded_table_flowable(el, ctx, registry, available_width)
                if tbl is not None:
                    result.append(tbl)
        else:
            current_runs.append(run)

    flush()
    return result


def _expand_area_inline(
    area_id: str,
    ctx: DocumentContext,
    registry: StyleRegistry,
    page_vars: dict | None,
    area_elements: list | None,
    available_width: float,
    extra_area_lookup: dict | None,
) -> list[TextRun]:
    """
    Recursively flatten a sub-area into a list of TextRun objects so it can be
    merged inline into the parent paragraph — replicating the browser's inline
    rendering of area-tag spans.

    Multi-paragraph sub-areas get a newline TextRun between paragraphs.
    """
    sub_area = (extra_area_lookup or {}).get(area_id) or resolve_area(area_id, ctx)
    if not sub_area:
        return []

    sub_html = sub_area.get("content", "")
    sub_paras = parse_content(sub_html)
    resolve_paragraphs(sub_paras, ctx.data, page_vars)

    sub_lookup = {c["id"]: c for c in sub_area.get("children", [])}
    if extra_area_lookup:
        sub_lookup = {**extra_area_lookup, **sub_lookup}

    result: list[TextRun] = []
    for i, sp in enumerate(sub_paras):
        if i > 0:
            result.append(TextRun(text="\n", style=sp.runs[0].style if sp.runs else InlineStyle()))
        for run in sp.runs:
            if run.is_area_ref:
                result.extend(_expand_area_inline(
                    run.area_id, ctx, registry, page_vars,
                    sub_area.get("elements", []), available_width, sub_lookup,
                ))
            elif not run.is_element_ref:
                result.append(run)
    return result


def _collect_single_rows(rs_id: str | None, index: dict) -> list[dict]:
    """Walk the rowSet tree and return all single-row rowSets in document order."""
    if not rs_id:
        return []
    rs = index.get(rs_id)
    if not rs:
        return []
    rs_type = rs.get("type")
    if rs_type == "single-row":
        return [rs]
    if rs_type == "multiple-rows":
        result = []
        for child_id in rs.get("childIds", []):
            result.extend(_collect_single_rows(child_id, index))
        return result
    if rs_type == "header-footer":
        result = []
        for key in ("firstHeaderId", "headerId", "bodyId", "footerId", "lastFooterId"):
            child_id = rs.get(key)
            if child_id:
                result.extend(_collect_single_rows(child_id, index))
        return result
    return []


def _build_embedded_table_flowable(
    element: dict,
    ctx: DocumentContext,
    registry: StyleRegistry,
    available_width: float,
) -> object | None:
    """
    Build a ReportLab Table flowable from an embedded table element
    (uses rowSets + cell.flow.content, not dataSource).
    """
    columns = element.get("columns", [])
    if not columns:
        return None

    col_widths = _resolve_col_widths_ratio(columns, available_width)

    row_sets = element.get("rowSets", [])
    rs_index = {rs["id"]: rs for rs in row_sets}
    root_rs_id = element.get("rootRowSetId")
    all_rows = _collect_single_rows(root_rs_id, rs_index)

    if not all_rows:
        return None

    def cell_flowables(cell: dict | None) -> list:
        if cell is None:
            return [RLParagraph("", _default_cell_style(registry))]
        flow = cell.get("flow", {})
        html = flow.get("content", "")
        children = {c["id"]: c for c in flow.get("children", [])}
        paragraphs = parse_content(html)
        resolve_paragraphs(paragraphs, ctx.data, None)
        story = []
        for para in paragraphs:
            for f in _para_to_flowables(
                para,
                registry.text(flow.get("defaultTextStyleId", "ts_default")),
                ctx, registry, None,
                area_elements=flow.get("elements", []),
                available_width=available_width / max(len(columns), 1),
                extra_area_lookup=children,
            ):
                story.append(f)
        return story or [RLParagraph("", _default_cell_style(registry))]

    table_data = []
    style_cmds = [
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING",   (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 2),
    ]

    for row_idx, rs in enumerate(all_rows):
        cells_data = rs.get("cells", [])
        row = []
        for col_idx, col in enumerate(columns):
            cell = next((c for c in cells_data if c.get("colId") == col["id"]), None)
            row.append(cell_flowables(cell))
            if cell:
                border = cell.get("border", {})
                if border.get("inline"):
                    sides = border.get("sides", {})
                    for side, cmd in (("top", "LINEABOVE"), ("bottom", "LINEBELOW"),
                                      ("left", "LINEBEFORE"), ("right", "LINEAFTER")):
                        s = sides.get(side, {})
                        if s.get("enabled"):
                            w = mm(s.get("lineWidth", 0.25))
                            c = colors.HexColor(s.get("lineColor", "#000000"))
                            style_cmds.append((cmd, (col_idx, row_idx), (col_idx, row_idx), w, c))
        table_data.append(row)

    tbl = Table(table_data, colWidths=col_widths)
    tbl.setStyle(TableStyle(style_cmds))
    return tbl


def _resolve_col_widths_ratio(columns: list[dict], total_w_pt: float) -> list[float]:
    """Resolve widths that use widthRatio (0-1) or width+widthUnit."""
    widths = []
    for col in columns:
        if "widthRatio" in col:
            widths.append(total_w_pt * float(col["widthRatio"]))
        else:
            unit = col.get("widthUnit", "mm")
            val  = col.get("width", 20)
            widths.append(total_w_pt * val / 100 if unit == "%" else mm(val))

    total = sum(widths)
    if total > 0 and abs(total - total_w_pt) > 1:
        factor = total_w_pt / total
        widths = [w * factor for w in widths]
    return widths


def _default_cell_style(registry: StyleRegistry) -> RLParagraphStyle:
    ts = registry.text("ts_default")
    return RLParagraphStyle(
        "emb_cell",
        fontName=registry.font_name(ts),
        fontSize=ts.font_size,
        leading=ts.font_size * ts.line_height,
    )


# ── XML / style helpers ───────────────────────────────────────────────────────

def _runs_to_rl_xml(
    runs: list[TextRun],
    default_ts: ResolvedTextStyle,
    registry: StyleRegistry,
) -> str:
    parts = []
    for run in runs:
        if run.is_area_ref or run.is_element_ref:
            continue
        # newline runs (from multi-paragraph inline area expansion) → <br/>
        if run.text == "\n":
            parts.append("<br/>")
            continue
        text = _esc(run.text)
        if not text:
            continue

        ts = run.style
        open_tags: list[str] = []
        close_tags: list[str] = []

        color = ts.color or default_ts.color
        resolved_ts = registry.text(ts.text_style_id) if ts.text_style_id else default_ts
        font_name = registry.font_name(resolved_ts)
        font_size = ts.font_size_override or default_ts.font_size

        open_tags.append(f'<font name="{font_name}" size="{font_size:.1f}" color="{color}">')
        close_tags.insert(0, "</font>")

        if ts.bold or (not ts.text_style_id and default_ts.bold):
            open_tags.append("<b>"); close_tags.insert(0, "</b>")
        if ts.italic or (not ts.text_style_id and default_ts.italic):
            open_tags.append("<i>"); close_tags.insert(0, "</i>")
        if ts.underline or default_ts.underline:
            open_tags.append("<u>"); close_tags.insert(0, "</u>")
        if ts.strikethrough or default_ts.strikethrough:
            open_tags.append("<strike>"); close_tags.insert(0, "</strike>")
        if ts.superscript:
            open_tags.append("<super>"); close_tags.insert(0, "</super>")
        if ts.subscript:
            open_tags.append("<sub>"); close_tags.insert(0, "</sub>")

        parts.append("".join(open_tags) + text + "".join(close_tags))

    return "".join(parts)


def _make_rl_style(
    ts: ResolvedTextStyle,
    registry: StyleRegistry,
    para: Paragraph | None = None,
) -> RLParagraphStyle:
    # (antes: left_indent = mm(ts.letter_spacing) "repurposed" — un estilo con
    # interletra real ganaba una sangría fantasma; la interletra ahora tiene
    # semántica propia en text_renderer y aquí NO se abusa del campo)
    left_indent = 0
    if para and para.list_item:
        left_indent = mm(5 * para.list_depth)

    return RLParagraphStyle(
        name="ca_dynamic",
        fontName=registry.font_name(ts),
        fontSize=ts.font_size,
        leading=ts.font_size * ts.line_height,
        textColor=registry.rl_color(ts.color),
        alignment=TA_LEFT,
        wordWrap="CJK",
        leftIndent=left_indent,
    )


def _make_list_item(xml_text: str, base_style: RLParagraphStyle, para: Paragraph):
    bullet = "•" if para.list_type == "bullet" else ""
    style = RLParagraphStyle(
        "li",
        parent=base_style,
        leftIndent=mm(5 * max(para.list_depth, 1)),
        bulletIndent=mm(5 * max(para.list_depth, 1) - 4),
        bulletText=bullet,
    )
    return RLParagraph(xml_text, style)


def _esc(text: str) -> str:
    return (text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;"))
