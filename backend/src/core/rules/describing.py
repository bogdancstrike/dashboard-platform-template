"""Describing a condition tree in words."""

from __future__ import annotations

from typing import Any

from src.core.errors import ValidationError
from src.core.query import FieldSet, canonical_operator
from src.core.rules.compiling import (
    _TEXT_OPERATOR,
    _VALUELESS,
    MAX_DEPTH,
    _children,
    _rule_parts,
)


def describe_tree(tree: dict[str, Any] | None, spec: FieldSet, *, indent: int = 0) -> str:
    """The parenthesised, indented rendering the query inspector shows (§51)."""
    if not tree or not isinstance(tree, dict):
        return ""
    return _describe_node(tree, spec, indent=indent, depth=0)


def _describe_node(node: dict[str, Any], spec: FieldSet, *, indent: int, depth: int) -> str:
    pad = "    " * indent
    kind = (node.get("type") or "group").lower()

    if kind in ("group", "rule_group"):
        if depth > MAX_DEPTH:
            return f"{pad}…"
        properties = node.get("properties") or {}
        conjunction = str(properties.get("conjunction") or node.get("conjunction") or "AND").upper()
        parts = [
            text
            for child in _children(node)
            if (text := _describe_node(child, spec, indent=indent + 1, depth=depth + 1)).strip()
        ]
        if not parts:
            return ""
        joiner = f"\n{pad}    {conjunction}\n"
        body = joiner.join(parts)
        negation = "NOT " if properties.get("not", node.get("not")) else ""
        if depth == 0 and not negation:
            # The root group needs no parentheses; they only add noise.
            return body
        return f"{pad}{negation}(\n{body}\n{pad})"

    field, operator, value = _rule_parts(node)
    if not field:
        return ""
    field_spec = spec.by_name.get(field)
    label = field_spec.title if field_spec else field
    try:
        canonical = canonical_operator(operator)
    except ValidationError:
        canonical = "eq"
    symbol = _TEXT_OPERATOR.get(canonical, canonical)

    if canonical in _VALUELESS:
        return f"{pad}{label} {symbol}"
    if value in (None, "", []):
        return ""
    if isinstance(value, (list, tuple)):
        if canonical == "between" and len(value) >= 2:
            rendered = f"{_literal(value[0])} AND {_literal(value[1])}"
        else:
            rendered = "[" + ", ".join(_literal(v) for v in value) + "]"
    else:
        rendered = _literal(value)
    return f"{pad}{label} {symbol} {rendered}"


def _literal(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    return text if text.replace(".", "", 1).isdigit() else f"'{text}'"
