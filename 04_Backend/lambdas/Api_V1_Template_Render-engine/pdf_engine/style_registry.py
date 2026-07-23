"""
style_registry.py

Builds in-memory lookup tables for all style types defined in templateJson.styles.
All lookups are by string ID; falls back to the default style when an ID is missing.

Usage:
    registry = StyleRegistry.from_context(doc_context)
    ts = registry.text("ts_1234_abc")
    ps = registry.paragraph("ps_default")
    color = registry.rl_color("#246ed6", opacity=0.8)
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional

from reportlab.lib.colors import Color, HexColor

from pdf_engine.normalize import DocumentContext
from pdf_engine.font_manager import FontManager, _default as _default_fm


def _num(value, default: float) -> float:
    """
    Coerce a numeric-ish style value to float.

    The DocumentDesigner front-end may emit numbers, numeric strings, empty
    strings, or CSS keywords like ``"normal"``/``"auto"`` for fields that the
    renderer treats as numbers (e.g. ``lineHeight``, ``fontSize``). Anything that
    isn't a usable number falls back to ``default`` — this prevents errors like
    ``'<=' not supported between 'str' and 'float'`` deep inside ReportLab.
    """
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        s = value.strip().lower()
        if s in ("", "normal", "auto", "none", "inherit"):
            return default
        try:
            return float(s)
        except ValueError:
            return default
    return default


# ── Data classes (resolved style objects) ─────────────────────────────────────

@dataclass
class ResolvedTextStyle:
    id: str
    font_family: str = "Helvetica"
    font_weight: str = "Regular"   # "Regular" | "Bold" | "Light" | ...
    font_size: float = 12          # in points (JSON stores pt directly)
    color: str = "#000000"
    italic: bool = False
    bold: bool = False
    underline: bool = False
    strikethrough: bool = False
    letter_spacing: float = 0
    line_height: float = 1.4
    superscript: bool = False
    subscript: bool = False
    superscript_offset: float = 33
    subscript_offset: float = 33
    super_sub_size: float = 58     # % of font size
    text_transform: str = "none"   # "none"|"uppercase"|"lowercase"|"capitalize"
    fill_style_id: Optional[str] = None
    border_style_id: Optional[str] = None


@dataclass
class ResolvedParagraphStyle:
    id: str
    alignment: str = "left"        # "left"|"center"|"right"|"justify"
    vertical_align: str = "top"    # "top"|"middle"|"bottom"
    line_height: float = 1.4
    first_line_indent: float = 0   # mm
    left_indent: float = 0         # mm
    right_indent: float = 0        # mm
    space_before: float = 0        # mm
    space_after: float = 0         # mm
    word_wrap: bool = True
    list_style: str = "none"       # "none"|"bullet"|"numbered"
    list_indent: float = 5         # mm
    list_color: str = ""
    default_text_style_id: Optional[str] = None


@dataclass
class ResolvedFillStyle:
    id: str
    type: str = "solid"            # "solid"|"gradient"|"none"
    color: str = "#ffffff"
    opacity: float = 1.0
    gradient: Optional[dict] = None


@dataclass
class ResolvedBorderStyle:
    id: str
    line_width: float = 1.0        # mm
    line_color: str = "#000000"
    line_style: str = "Solid"      # "Solid"|"Dashed"|"Dotted"
    sides: dict = field(default_factory=dict)
    radius_x: float = 0            # mm
    radius_y: float = 0            # mm
    fill_fill_style_id: Optional[str] = None
    line_fill_style_id: Optional[str] = None
    margin_top: float = 0
    margin_right: float = 0
    margin_bottom: float = 0
    margin_left: float = 0


# ── Registry ──────────────────────────────────────────────────────────────────

class StyleRegistry:

    def __init__(self) -> None:
        self._text: dict[str, ResolvedTextStyle] = {}
        self._paragraph: dict[str, ResolvedParagraphStyle] = {}
        self._fill: dict[str, ResolvedFillStyle] = {}
        self._border: dict[str, ResolvedBorderStyle] = {}
        self._fm: FontManager = _default_fm

    @classmethod
    def from_context(
        cls,
        ctx: DocumentContext,
        font_manager: FontManager | None = None,
    ) -> "StyleRegistry":
        registry = cls()
        registry._fm = font_manager or _default_fm
        styles = ctx.styles
        registry._load_text(styles.get("text", []))
        registry._load_paragraph(styles.get("paragraph", []))
        registry._load_fill(styles.get("fill", []))
        registry._load_border(styles.get("border", []))
        return registry

    # ── Loaders ───────────────────────────────────────────────────────────────

    def _load_text(self, entries: list[dict]) -> None:
        for ts in entries:
            weight = ts.get("fontWeight", "Regular")
            self._text[ts["id"]] = ResolvedTextStyle(
                id=ts["id"],
                font_family=ts.get("fontFamily", "Helvetica"),
                font_weight=weight,
                font_size=_num(ts.get("fontSize"), 12),
                color=ts.get("color", "#000000"),
                italic=ts.get("italic", False),
                bold=(weight == "Bold"),
                underline=ts.get("underline", False),
                strikethrough=ts.get("strikethrough", False),
                letter_spacing=_num(ts.get("letterSpacing"), 0),
                line_height=_num(ts.get("lineHeight"), 1.4),
                superscript=ts.get("superscript", False),
                subscript=ts.get("subscript", False),
                superscript_offset=_num(ts.get("superscriptOffset"), 33),
                subscript_offset=_num(ts.get("subscriptOffset"), 33),
                super_sub_size=_num(ts.get("superSubSize"), 58),
                text_transform=ts.get("textTransform", "none"),
                fill_style_id=ts.get("fillStyleId"),
                border_style_id=ts.get("borderStyleId"),
            )

    def _load_paragraph(self, entries: list[dict]) -> None:
        for ps in entries:
            self._paragraph[ps["id"]] = ResolvedParagraphStyle(
                id=ps["id"],
                alignment=ps.get("alignment", "left"),
                vertical_align=ps.get("verticalAlign", "top"),
                line_height=_num(ps.get("lineHeight"), 1.4),
                first_line_indent=_num(ps.get("firstLineIndent"), 0),
                left_indent=_num(ps.get("leftIndent"), 0),
                right_indent=_num(ps.get("rightIndent"), 0),
                space_before=_num(ps.get("spaceBefore"), 0),
                space_after=_num(ps.get("spaceAfter"), 0),
                word_wrap=ps.get("wordWrap", True),
                list_style=ps.get("listStyle", "none"),
                list_indent=_num(ps.get("listIndent"), 5),
                list_color=ps.get("listColor", ""),
                default_text_style_id=ps.get("defaultTextStyleId"),
            )

    def _load_fill(self, entries: list[dict]) -> None:
        for fs in entries:
            self._fill[fs["id"]] = ResolvedFillStyle(
                id=fs["id"],
                type=fs.get("type", "solid"),
                color=fs.get("color", "#ffffff"),
                opacity=_num(fs.get("opacity"), 1.0),
                gradient=fs.get("gradient") if fs.get("type") == "gradient" else None,
            )

    def _load_border(self, entries: list[dict]) -> None:
        for bs in entries:
            self._border[bs["id"]] = ResolvedBorderStyle(
                id=bs["id"],
                line_width=_num(bs.get("lineWidth"), 1.0),
                line_color=bs.get("lineColor", "#000000"),
                line_style=bs.get("lineStyle", "Solid"),
                sides=bs.get("sides", {}),
                radius_x=_num(bs.get("radiusX"), 0),
                radius_y=_num(bs.get("radiusY"), 0),
                fill_fill_style_id=bs.get("fillFillStyleId"),
                line_fill_style_id=bs.get("lineFillStyleId"),
                margin_top=_num(bs.get("marginTop"), 0),
                margin_right=_num(bs.get("marginRight"), 0),
                margin_bottom=_num(bs.get("marginBottom"), 0),
                margin_left=_num(bs.get("marginLeft"), 0),
            )

    # ── Public lookups ─────────────────────────────────────────────────────────

    def text(self, style_id: str | None) -> ResolvedTextStyle:
        if style_id and style_id in self._text:
            return self._text[style_id]
        return self._text.get("ts_default", ResolvedTextStyle(id="ts_default"))

    def paragraph(self, style_id: str | None) -> ResolvedParagraphStyle:
        if style_id and style_id in self._paragraph:
            return self._paragraph[style_id]
        return self._paragraph.get("ps_default", ResolvedParagraphStyle(id="ps_default"))

    def fill(self, style_id: str | None) -> Optional[ResolvedFillStyle]:
        if style_id:
            return self._fill.get(style_id)
        return None

    def border(self, style_id: str | None) -> Optional[ResolvedBorderStyle]:
        if style_id:
            return self._border.get(style_id)
        return None

    # ── ReportLab color helpers ───────────────────────────────────────────────

    def rl_color(self, hex_color: str, opacity: float = 1.0) -> Color:
        """Convert a hex string (#rrggbb) to a ReportLab Color."""
        try:
            c = HexColor(hex_color)
            if opacity < 1.0:
                # ReportLab Color accepts alpha as 4th component
                return Color(c.red, c.green, c.blue, opacity)
            return c
        except Exception:
            return HexColor("#000000")

    def rl_color_from_fill(self, fill_style_id: str | None) -> Optional[Color]:
        """Resolve a fill style ID to its ReportLab color, or None."""
        fs = self.fill(fill_style_id)
        if fs and fs.type == "solid":
            return self.rl_color(fs.color, fs.opacity)
        return None

    def font_name(self, ts: ResolvedTextStyle) -> str:
        """Resolve font family + style to a registered ReportLab font name."""
        return self._fm.resolve(ts.font_family, ts.bold, ts.italic)
