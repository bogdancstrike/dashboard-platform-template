"""Binding record lists, and the queries a spec asks."""

from __future__ import annotations

from typing import Any

from src.services.analytics.insights.spec.binding import _walk


def queries_of(spec: dict[str, Any]) -> list[str]:
    """The datasets an insight reads — what a viewer needs permission for."""
    out = []
    for node in _walk(spec.get("blocks") or []):
        for key in ("query", "records"):
            if key in node and node[key]["dataset"] not in out:
                out.append(node[key]["dataset"])
    return out
