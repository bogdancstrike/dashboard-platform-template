"""Suggested insights, one set per dataset (§43).
See docs/architecture/backend/suggestions.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "builders": ("_kpi", "_chart", "_records"),
    "catalogue": ("SUGGESTIONS",),
    "lookup": ("for_viewer", "find"),
})
