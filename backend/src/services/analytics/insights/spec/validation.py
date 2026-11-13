"""The insight spec vocabulary, and validating a spec."""

from __future__ import annotations

from typing import Any

from src.services.analytics.insights.spec.props import (
    _inline,
    _prop,
    _query,
    _records,
    _text,
    _width,
)
from src.services.analytics.insights.spec.vocabulary import (
    MAX_DEPTH,
    MAX_NODES,
    MAX_TEXT,
    QUERIED,
    REGISTRY,
    SPEC_VERSION,
    WIDTHS,
    SpecError,
)


def validate(raw: Any) -> tuple[dict[str, Any], list[str]]:
    """A clean spec and what was dropped from it. Raises SpecError only when
    there is nothing usable."""
    if not isinstance(raw, dict):
        raise SpecError("The insight is not an object.")
    warnings: list[str] = []
    counter = {"nodes": 0}
    blocks = _nodes(raw.get("blocks"), warnings, counter, depth=1)
    if not blocks:
        raise SpecError("The insight has no components the registry knows.")
    spec = {
        "version": SPEC_VERSION,
        "title": _text(raw.get("title"), MAX_TEXT) or "Insight",
        "summary": _text(raw.get("summary"), 600),
        "blocks": blocks,
    }
    return spec, warnings


def _nodes(raw: Any, warnings: list[str], counter: dict[str, int], *, depth: int) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out = []
    for index, item in enumerate(raw):
        if counter["nodes"] >= MAX_NODES:
            warnings.append(f"Only the first {MAX_NODES} components were kept.")
            break
        node = _node(item, warnings, counter, depth=depth, where=f"block {index + 1}")
        if node is not None:
            out.append(node)
    return out


def _node(item: Any, warnings: list[str], counter: dict[str, int], *, depth: int, where: str) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        warnings.append(f"{where}: not a component, skipped.")
        return None
    kind = str(item.get("type") or "").strip().lower()
    if kind not in REGISTRY:
        warnings.append(f"{where}: unknown component {kind or '(none)'!r}, skipped.")
        return None
    if kind == "section" and depth >= MAX_DEPTH:
        warnings.append(f"{where}: sections do not nest, skipped.")
        return None
    counter["nodes"] += 1
    node: dict[str, Any] = {"type": kind, "width": item.get("width") if item.get("width") in WIDTHS else _width(kind)}
    for prop, shape in REGISTRY[kind].items():
        value = _prop(item.get(prop), shape)
        if value is not None:
            node[prop] = value
    if kind == "section":
        node["blocks"] = _nodes(item.get("blocks"), warnings, counter, depth=depth + 1)
        return node if node["blocks"] else None
    if kind in QUERIED:
        query = _query(item.get("query"))
        records = _records(item.get("records"))
        if query:
            node["query"] = query
        elif records and kind in ("table", "list", "timeline"):
            node["records"] = records
        inline = _inline(kind, item)
        if inline is not None:
            node["data"] = inline
        if not (query or node.get("records") or inline is not None or (kind in ("kpi", "progress") and "value" in node)):
            warnings.append(f"{where}: a {kind} with no data or query, skipped.")
            counter["nodes"] -= 1
            return None
    if kind in ("markdown",) and not node.get("text"):
        counter["nodes"] -= 1
        return None
    return node
