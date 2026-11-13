"""The audit explorer (§21): who did what, when, and what changed.
See docs/architecture/backend/audit.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "ledger": (
        "LEDGER_PERMISSION", "TIMELINE_PERMISSION", "EXPORT_PERMISSION", "MAX_TIMELINE", "_fields",
        "DEFAULT_COLUMNS", "EXPORT_COLUMNS", "_statement", "catalogue", "listing", "export",
        "_export_columns",
    ),
    "serializers": ("summarise", "detail", "_change_kind", "_mask", "_absent", "_json"),
    "timeline_view": ("entry", "timeline", "_neighbours", "_truthy"),
})
