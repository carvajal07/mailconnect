"""
html_parser.py

Parses the HTML stored in contentArea.content into a flat list of TextRun
objects, each carrying its own inline style overrides.

The HTML produced by the React rich-text editor contains:
  - Plain text nodes
  - <span style="...">   — inline CSS overrides (color, font-weight, font-style, font-size)
  - <span class="var-tag" data-var="NAME">   — variable placeholder
  - <span class="area-tag" data-area="AREA_ID">  — inline sub-area reference
  - <div>, <p>           — block containers (treated as paragraph breaks)
  - <ul>/<ol>/<li>       — lists
  - <br>                 — line break
  - <b>, <strong>        — bold shorthand
  - <i>, <em>            — italic shorthand
  - <span style="vertical-align: super/sub">  — super/subscript
  - <span style="font-size: x-small|small|large|x-large|xx-large|xxx-large">

Output is a list of Paragraph objects, each containing a list of TextRun objects.
The renderer decides how to lay these out in ReportLab.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Optional


# ── Output types ──────────────────────────────────────────────────────────────

@dataclass
class InlineStyle:
    """Accumulated inline style state at a given point in the HTML tree."""
    bold: bool = False
    italic: bool = False
    underline: bool = False
    strikethrough: bool = False
    color: Optional[str] = None        # hex string e.g. "#246ed6"
    font_size_override: Optional[float] = None  # pt
    superscript: bool = False
    subscript: bool = False
    text_style_id: Optional[str] = None  # set when a named class is applied

    def merge(self, other: "InlineStyle") -> "InlineStyle":
        """Return a new style with other's non-None values taking precedence."""
        return InlineStyle(
            bold=other.bold or self.bold,
            italic=other.italic or self.italic,
            underline=other.underline or self.underline,
            strikethrough=other.strikethrough or self.strikethrough,
            color=other.color if other.color is not None else self.color,
            font_size_override=(
                other.font_size_override
                if other.font_size_override is not None
                else self.font_size_override
            ),
            superscript=other.superscript or self.superscript,
            subscript=other.subscript or self.subscript,
            text_style_id=other.text_style_id or self.text_style_id,
        )


@dataclass
class TextRun:
    """A contiguous piece of text with uniform styling."""
    text: str
    style: InlineStyle = field(default_factory=InlineStyle)
    is_var: bool = False          # True → text is a variable name, not literal
    var_name: str = ""            # e.g. "userId", "$pageNumber"
    is_area_ref: bool = False     # True → inline sub-area reference
    area_id: str = ""             # e.g. "area_32autf"
    is_element_ref: bool = False  # True → embedded element (table, image…)
    element_id: str = ""          # e.g. "tbl_xxx"
    element_type: str = ""        # e.g. "table"


@dataclass
class Paragraph:
    """A block-level container (maps to a <p>, <div>, or <li>)."""
    runs: list[TextRun] = field(default_factory=list)
    list_item: bool = False
    list_depth: int = 0
    list_type: str = "none"    # "none" | "bullet" | "numbered"

    def is_empty(self) -> bool:
        return all(
            r.text.strip() == "" and not r.is_var
            and not r.is_area_ref and not r.is_element_ref
            for r in self.runs
        )


# ── CSS helpers ───────────────────────────────────────────────────────────────

_NAMED_SIZES: dict[str, float] = {
    "xx-small": 6,
    "x-small":  8,
    "small":   10,
    "medium":  12,
    "large":   14,
    "x-large": 18,
    "xx-large": 24,
    "xxx-large": 36,
}


def _parse_css(style_attr: str) -> InlineStyle:
    """Parse a CSS style attribute string into an InlineStyle."""
    result = InlineStyle()
    for declaration in style_attr.split(";"):
        declaration = declaration.strip()
        if not declaration or ":" not in declaration:
            continue
        prop, _, value = declaration.partition(":")
        prop = prop.strip().lower()
        value = value.strip().lower()

        if prop == "color":
            result.color = _css_color_to_hex(value)
        elif prop == "font-weight" and value in ("bold", "700", "800", "900"):
            result.bold = True
        elif prop == "font-style" and value == "italic":
            result.italic = True
        elif prop == "text-decoration":
            if "underline" in value:
                result.underline = True
            if "line-through" in value:
                result.strikethrough = True
        elif prop == "vertical-align":
            if value == "super":
                result.superscript = True
            elif value == "sub":
                result.subscript = True
        elif prop == "font-size":
            if value in _NAMED_SIZES:
                result.font_size_override = _NAMED_SIZES[value]
            elif value.endswith("px"):
                result.font_size_override = float(value[:-2]) * 0.75  # px → pt
            elif value.endswith("pt"):
                result.font_size_override = float(value[:-2])
    return result


def _css_color_to_hex(value: str) -> Optional[str]:
    """Convert css color string to hex. Handles #hex and rgb(r,g,b)."""
    value = value.strip()
    if value.startswith("#"):
        return value
    if value.startswith("rgb("):
        try:
            nums = value[4:-1].split(",")
            r, g, b = (int(n.strip()) for n in nums[:3])
            return f"#{r:02x}{g:02x}{b:02x}"
        except (ValueError, IndexError):
            pass
    return None


# ── Parser ────────────────────────────────────────────────────────────────────

class _ContentHTMLParser(HTMLParser):

    def __init__(self) -> None:
        super().__init__()
        self.paragraphs: list[Paragraph] = [Paragraph()]
        self._style_stack: list[InlineStyle] = [InlineStyle()]
        self._list_stack: list[str] = []   # "ul" | "ol"
        self._in_li: bool = False
        # Track spans to suppress content INSIDE var/area/element-tag spans only.
        # Each entry = True if this span is a suppressed special tag, False if normal.
        self._span_type_stack: list[bool] = []

    # ── Current state helpers ─────────────────────────────────────────────────

    @property
    def _current_para(self) -> Paragraph:
        return self.paragraphs[-1]

    @property
    def _current_style(self) -> InlineStyle:
        return self._style_stack[-1]

    def _push_style(self, delta: InlineStyle) -> None:
        self._style_stack.append(self._current_style.merge(delta))

    def _pop_style(self) -> None:
        if len(self._style_stack) > 1:
            self._style_stack.pop()

    def _new_paragraph(self, list_item: bool = False) -> None:
        self.paragraphs.append(Paragraph(
            list_item=list_item,
            list_depth=len(self._list_stack),
            list_type="bullet" if self._list_stack and self._list_stack[-1] == "ul"
                      else "numbered" if self._list_stack else "none",
        ))

    def _emit(self, text: str) -> None:
        if not text:
            return
        run = TextRun(text=text, style=self._current_style)
        self._current_para.runs.append(run)

    # ── HTMLParser callbacks ──────────────────────────────────────────────────

    def handle_starttag(self, tag: str, attrs_list: list) -> None:
        attrs = dict(attrs_list)
        cls = attrs.get("class", "")
        style_attr = attrs.get("style", "")

        if tag in ("p", "div"):
            if self._current_para.runs:
                self._new_paragraph()
            self._push_style(InlineStyle())

        elif tag == "br":
            self._emit("\n")

        elif tag in ("b", "strong"):
            self._push_style(InlineStyle(bold=True))

        elif tag in ("i", "em"):
            self._push_style(InlineStyle(italic=True))

        elif tag == "u":
            self._push_style(InlineStyle(underline=True))

        elif tag in ("s", "strike", "del"):
            self._push_style(InlineStyle(strikethrough=True))

        elif tag == "ul":
            self._list_stack.append("ul")
            self._push_style(InlineStyle())

        elif tag == "ol":
            self._list_stack.append("ol")
            self._push_style(InlineStyle())

        elif tag == "li":
            self._in_li = True
            self._new_paragraph(list_item=True)
            self._push_style(InlineStyle())

        elif tag == "span":
            if "area-tag" in cls:
                area_id = attrs.get("data-area", "")
                run = TextRun(
                    text="",
                    style=self._current_style,
                    is_area_ref=True,
                    area_id=area_id,
                )
                self._current_para.runs.append(run)
                self._push_style(InlineStyle())
                self._span_type_stack.append(True)  # suppress content inside

            elif "element-tag" in cls:
                el_id   = attrs.get("data-element", "")
                el_type = attrs.get("data-type", "")
                run = TextRun(
                    text="",
                    style=self._current_style,
                    is_element_ref=True,
                    element_id=el_id,
                    element_type=el_type,
                )
                self._current_para.runs.append(run)
                self._push_style(InlineStyle())
                self._span_type_stack.append(True)  # suppress content inside

            elif "var-tag" in cls:
                var_name = attrs.get("data-var", "")
                run = TextRun(
                    text=f"${{{var_name}}}",
                    style=self._current_style,
                    is_var=True,
                    var_name=var_name,
                )
                self._current_para.runs.append(run)
                self._push_style(InlineStyle())
                self._span_type_stack.append(True)  # suppress content inside

            else:
                delta = _parse_css(style_attr) if style_attr else InlineStyle()
                self._push_style(delta)
                self._span_type_stack.append(False)  # normal span

        else:
            self._push_style(InlineStyle())

    def handle_endtag(self, tag: str) -> None:
        if tag in ("p", "div", "li"):
            self._pop_style()
            if tag == "li":
                self._in_li = False
        elif tag in ("ul", "ol"):
            if self._list_stack:
                self._list_stack.pop()
            self._pop_style()
        elif tag == "span":
            if self._span_type_stack:
                self._span_type_stack.pop()
            self._pop_style()
        else:
            self._pop_style()

    # Zero-width and invisible Unicode chars added by the contenteditable editor
    # as cursor anchors — meaningless in PDF, render as "■" in Helvetica so strip them.
    _STRIP_INVISIBLE = str.maketrans("", "", "​‌‍﻿­")

    def handle_data(self, data: str) -> None:
        # Suppress only if we are INSIDE a special tag (var/area/element).
        if self._span_type_stack and self._span_type_stack[-1]:
            return
        self._emit(data.translate(self._STRIP_INVISIBLE))


# ── Public API ────────────────────────────────────────────────────────────────

def parse_content(html: str) -> list[Paragraph]:
    """
    Parse the HTML content string of a contentArea into a list of Paragraphs.
    Empty paragraphs at the end are dropped.
    """
    parser = _ContentHTMLParser()
    parser.feed(html or "")
    paragraphs = parser.paragraphs

    # Remove trailing empty paragraphs
    while paragraphs and paragraphs[-1].is_empty():
        paragraphs.pop()

    return paragraphs or [Paragraph()]
