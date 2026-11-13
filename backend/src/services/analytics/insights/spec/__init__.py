"""The UI spec an insight is drawn from, and the data bound into it (§43).
See docs/architecture/backend/spec.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "vocabulary": (
        "SPEC_VERSION", "REGISTRY", "CHARTS", "QUERIED", "WIDTHS", "FORMATS", "TONES", "MAX_NODES",
        "MAX_DEPTH", "MAX_TEXT", "MAX_LONG", "MAX_ROWS", "MAX_INLINE_ITEMS", "SpecError",
    ),
    "props": ("_width", "_text", "_prop", "_query", "_records", "_inline"),
    "validation": ("validate", "_nodes", "_node"),
    "binding": ("bind", "_walk", "_analysis_payload", "_bind_query", "_previous", "_bind_records"),
    "queries": ("queries_of",),
})
