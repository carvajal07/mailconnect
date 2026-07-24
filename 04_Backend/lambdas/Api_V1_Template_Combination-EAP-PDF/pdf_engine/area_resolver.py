"""
area_resolver.py

Resolves which contentArea to render given a parent area's flowType and
selectionScript/conditions. Also expands inline area-tag references.

flowType values observed in the JSON:
  - (absent / "simple")   → always render the area's own content
  - "inline-condition"    → evaluate selectionScript; render trueAreaId or falseAreaId

selectionType:
  - "bool"    → selectionVariable is a boolean variable name in data context
  - "script"  → selectionScript is JS-like code ("return true;" / "return expr;")

Because this runs server-side in Python we evaluate selectionScript with a
minimal safe evaluator — not a full JS runtime. Supported expressions:
  - "return true;"  / "return false;"
  - "return <varName> == <value>;"
  - "return <varName> != <value>;"

For complex logic, expose a Python hook via ConditionEvaluator.register().
"""

from __future__ import annotations
import re
from typing import Any, Callable

from pdf_engine.normalize import DocumentContext


# ── Condition evaluator ───────────────────────────────────────────────────────

# Registry for custom condition functions keyed by script text
_custom_evaluators: dict[str, Callable[[dict], bool]] = {}


def register_condition(script: str, fn: Callable[[dict], bool]) -> None:
    """Register a Python function to handle a specific selectionScript string."""
    _custom_evaluators[script.strip()] = fn


def evaluate_condition(
    area: dict,
    ctx: DocumentContext,
) -> bool:
    """
    Evaluate the condition for a contentArea that has flowType='inline-condition'.
    Returns True if the 'true' branch should render, False for the 'false' branch.
    """
    selection_type = area.get("selectionType", "bool")
    script = (area.get("selectionScript") or "").strip()

    # Custom registered evaluator takes priority
    if script in _custom_evaluators:
        return _custom_evaluators[script](ctx.data)

    if selection_type == "bool":
        var_name = area.get("selectionVariable", "")
        value = ctx.data.get(var_name)
        return bool(value)

    if selection_type == "script":
        return _eval_script(script, ctx.data)

    return True


def _eval_script(script: str, data: dict[str, Any]) -> bool:
    """
    Minimal safe script evaluator for common patterns.
    Falls back to True on unrecognised scripts (log a warning in production).
    """
    # "return true;" / "return false;"
    if re.fullmatch(r"return\s+true\s*;?", script, re.I):
        return True
    if re.fullmatch(r"return\s+false\s*;?", script, re.I):
        return False

    # "return <var> == <value>;" or "return <var> != <value>;"
    m = re.fullmatch(
        r"return\s+(\w[\w.]*)\s*(==|!=|===|!==)\s*['\"]?([^'\";\s]*)['\"]?\s*;?",
        script,
        re.I,
    )
    if m:
        var_name, op, expected = m.group(1), m.group(2), m.group(3)
        actual = str(data.get(var_name, ""))
        if op in ("==", "==="):
            return actual == expected
        return actual != expected

    # Unknown script — default to True, render content
    return True


# ── Area resolution ───────────────────────────────────────────────────────────

def resolve_area(area_id: str, ctx: DocumentContext) -> dict | None:
    """
    Given an area ID, return the effective area dict to render.
    Handles inline-condition branching recursively.
    """
    area = ctx.get_area(area_id)
    if area is None:
        return None

    flow_type = area.get("flowType")

    if flow_type == "inline-condition":
        use_true = evaluate_condition(area, ctx)
        target_id = area.get("trueAreaId" if use_true else "falseAreaId", "")
        if target_id:
            return resolve_area(target_id, ctx)
        default_id = area.get("defaultAreaId", "")
        if default_id:
            return resolve_area(default_id, ctx)
        return None

    return area


def get_effective_content(area_id: str, ctx: DocumentContext) -> str:
    """Return the HTML content string for the resolved area."""
    area = resolve_area(area_id, ctx)
    if area is None:
        return ""
    return area.get("content", "")
