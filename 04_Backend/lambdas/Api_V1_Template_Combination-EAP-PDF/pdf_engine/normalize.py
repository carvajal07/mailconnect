"""
normalize.py

Converts the raw templateJson (as saved by the React frontend) into a clean
DocumentContext ready for the PDF engine.

What it does:
  - Strips UI-only fields (createdAt, updatedAt, locked, zIndex, pagePreview)
  - Collapses disabled borders/fills to None
  - Builds flat lookup indexes for contentAreas and image assets
  - Attaches the incoming data context for variable resolution

Nothing is written to disk; this runs once in memory per generation request.
"""

from __future__ import annotations
import copy
from typing import Any

# Fields only meaningful to the React UI editor — not needed by the PDF engine
_UI_FIELDS = frozenset({
    "createdAt", "updatedAt", "locked", "zIndex",
    "pagePreview", "pageCount", "elementCount",
    "guidelines", "anchors", "pageFlow",
})


def normalize(template_json: dict, data_context: dict | None = None) -> "DocumentContext":
    """
    Entry point. Returns a DocumentContext that the page_renderer consumes.

    Args:
        template_json: the templateJson dict from the document-designer node.
        data_context:  flat dict of variable values resolved from the workflow
                       (e.g. {"userId": 42, "email": "a@b.com"}).
    """
    t = copy.deepcopy(template_json)
    _strip_dict(t, _UI_FIELDS)

    # Strip UI fields from every style entry
    for style_list in t.get("styles", {}).values():
        if isinstance(style_list, list):
            for style in style_list:
                _strip_dict(style, {"createdAt", "updatedAt"})

    # Strip UI fields from fill/image assets
    for asset in t.get("images", []):
        _strip_dict(asset, {"createdAt", "updatedAt"})

    # Process pages and their elements
    for page in t.get("pages", []):
        _strip_dict(page, _UI_FIELDS)
        for element in page.get("elements", []):
            _process_element(element)

    # Build flat indexes
    asset_index = _build_asset_index(t.get("images", []))
    area_index = _build_area_index(t.get("contentAreas", []))

    return DocumentContext(
        template=t,
        asset_index=asset_index,
        area_index=area_index,
        data=data_context or {},
    )


# ── Element processing ────────────────────────────────────────────────────────

def _process_element(el: dict) -> None:
    _strip_dict(el, _UI_FIELDS)
    _collapse_border(el)
    _collapse_fill(el)
    _resolve_element_specifics(el)


def _collapse_border(el: dict) -> None:
    """Replace a fully-disabled border object with None."""
    border = el.get("border")
    if not border:
        return
    mode = border.get("mode", "none")
    if mode == "none":
        el["border"] = None
    elif mode == "unified" and not border.get("unified", {}).get("enabled", False):
        # Unified border defined but disabled — check if styleRef exists
        if not border.get("styleRef"):
            el["border"] = None


def _collapse_fill(el: dict) -> None:
    """Replace a fill of type 'none' with None."""
    fill = el.get("fill")
    if fill and fill.get("type") == "none":
        el["fill"] = None


def _resolve_element_specifics(el: dict) -> None:
    """Element-type-specific normalization."""
    el_type = el.get("type")
    if el_type == "image":
        # Mark the source kind for quick dispatch
        source = el.get("source", {})
        el["_sourceKind"] = source.get("kind", "placeholder")


# ── Index builders ────────────────────────────────────────────────────────────

def _build_asset_index(images: list[dict]) -> dict[str, dict]:
    """Flat lookup: assetId → image asset dict."""
    return {img["id"]: img for img in images}


def _build_area_index(
    areas: list[dict],
    index: dict[str, dict] | None = None,
) -> dict[str, dict]:
    """
    Recursively flattens the contentAreas tree into a dict keyed by area id.
    Enables O(1) lookup when resolving areaRef and area-tag references.
    """
    if index is None:
        index = {}
    for area in areas:
        index[area["id"]] = area
        _build_area_index(area.get("children", []), index)
    return index


# ── Utility ───────────────────────────────────────────────────────────────────

def _strip_dict(d: dict, fields: frozenset[str]) -> None:
    for f in fields:
        d.pop(f, None)


# ── DocumentContext ───────────────────────────────────────────────────────────

class DocumentContext:
    """
    Immutable view of the normalized template + runtime data.
    Passed through the entire rendering pipeline.
    """

    def __init__(
        self,
        template: dict,
        asset_index: dict[str, dict],
        area_index: dict[str, dict],
        data: dict[str, Any],
    ) -> None:
        self.template = template
        self.asset_index = asset_index
        self.area_index = area_index
        self.data = data

    # Convenience accessors
    @property
    def pages(self) -> list[dict]:
        return self.template.get("pages", [])

    @property
    def styles(self) -> dict:
        return self.template.get("styles", {})

    def get_area(self, area_id: str) -> dict | None:
        return self.area_index.get(area_id)

    def get_asset(self, asset_id: str) -> dict | None:
        return self.asset_index.get(asset_id)

    def get_var(self, name: str, default: Any = "") -> Any:
        return self.data.get(name, default)
