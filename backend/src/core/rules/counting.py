"""Describing one node, literals, rule counts and the always-true tree."""

from __future__ import annotations

from typing import Any

from sqlalchemy import false, true

from src.core.rules.compiling import _children


def rule_count(tree: dict[str, Any] | None) -> int:
    """How many complete rules a tree carries — shown on saved-search cards."""
    if not tree or not isinstance(tree, dict):
        return 0
    kind = (tree.get("type") or "group").lower()
    if kind in ("rule", "field"):
        return 1
    return sum(rule_count(child) for child in _children(tree))


def always(match: bool):
    """Explicit all/nothing predicates, so callers never pass a bare Python
    bool into `.where()` (SQLAlchemy 2 rejects it)."""
    return true() if match else false()
