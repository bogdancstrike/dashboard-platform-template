"""Data quality — what is wrong with the records, and where to go and fix it (§65).
See docs/architecture/backend/quality.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "checks": (
        "VIEW_PERMISSION", "SAMPLE", "STALE_CONTACT_DAYS", "SILENT_DEVICE_DAYS", "Check",
        "_relative",
    ),
    "check_catalogue": ("catalogue",),
    "findings_overview": ("overview", "summary", "_summary", "_count", "_finding", "_datasets"),
    "counting": ("_statement", "_link"),
})
