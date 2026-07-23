"""
variable_resolver.py

Resolves variable references in TextRun objects against the data context
that arrives from the workflow execution (webhook data + processor output).

Variable sources:
  - var-tag:  data-var="fieldName"   → ctx.data["fieldName"]
  - Special:  $pageNumber            → injected by page_renderer at render time
              $pageCount             → injected by page_renderer at render time
              $today                 → current date (ISO)
              $now                   → current datetime (ISO)

Nested field access uses dot notation: "user.address.city"
Array index access: "items.0.name"
"""

from __future__ import annotations
from datetime import date, datetime
from typing import Any

from pdf_engine.html_parser import Paragraph, TextRun


# ── Built-in special variables ────────────────────────────────────────────────

_SPECIAL_VARS = {
    "$today":     lambda _: date.today().isoformat(),
    "$now":       lambda _: datetime.now().isoformat(timespec="seconds"),
}

# Page-level vars are injected per page by page_renderer; they are listed here
# so they can be left as-is during the static resolution pass.
PAGE_VARS = {"$pageNumber", "$pageCount", "$totalPages"}


# ── Core resolver ─────────────────────────────────────────────────────────────

def resolve_var(name: str, data: dict[str, Any], page_vars: dict[str, Any] | None = None) -> str:
    """
    Resolve a single variable name to its string value.

    Priority:
      1. page_vars (pageNumber, pageCount — injected at render time)
      2. Special built-ins ($today, $now)
      3. data context (supports dot-path: "user.name")

    Returns empty string if not found.
    """
    if page_vars and name in page_vars:
        return str(page_vars[name])

    if name in _SPECIAL_VARS:
        return _SPECIAL_VARS[name](data)

    value = _get_nested(data, name)
    if value is None:
        return ""
    return _to_str(value)


def resolve_paragraphs(
    paragraphs: list[Paragraph],
    data: dict[str, Any],
    page_vars: dict[str, Any] | None = None,
) -> list[Paragraph]:
    """
    Walk all TextRun objects in the paragraphs and resolve is_var runs.
    area-tag runs are left unchanged (resolved by area_resolver).
    Returns the same list mutated in-place.
    """
    for para in paragraphs:
        for run in para.runs:
            if run.is_var and run.var_name not in PAGE_VARS:
                run.text = resolve_var(run.var_name, data, page_vars)
    return paragraphs


# ── Nested field access ───────────────────────────────────────────────────────

def _get_nested(data: Any, path: str) -> Any:
    """
    Traverse nested dicts/lists using dot notation.
    "user.address.city"  →  data["user"]["address"]["city"]
    "items.0.name"       →  data["items"][0]["name"]
    """
    parts = path.split(".")
    current = data
    for part in parts:
        if current is None:
            return None
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list):
            try:
                current = current[int(part)]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return current


def _to_str(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        # Avoid unnecessary decimals: 42.0 → "42", 3.14 → "3.14"
        return str(int(value)) if value == int(value) else str(value)
    return str(value)
