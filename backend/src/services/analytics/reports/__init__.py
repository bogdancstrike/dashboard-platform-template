"""Saved reports (§28).
See docs/architecture/backend/reports.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "access": (
        "KIND", "MANAGE_PERMISSION", "VIEW_PERMISSION", "SHARE_PERMISSION", "VISUALIZATIONS",
        "_visible", "_owned", "_apply_favorite", "_serialize", "_state",
    ),
    "validation": (
        "definition", "_resource", "_period", "_visualization", "_order", "_schedule", "_SCHEMA",
        "_validated", "_dimensions", "_metrics",
    ),
    "report_store": ("listing", "get", "create", "update", "remove", "duplicate", "run"),
    "serializers": ("_stored_dimensions", "_stored_measures"),
})
