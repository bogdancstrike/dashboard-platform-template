"""Importing records (§30): a wizard over an uploaded file — map columns, validate, execute, report.
See docs/architecture/backend/imports.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "targets": (
        "PERMISSION", "REFERENCE_PREFIX", "MAX_OPEN_PER_PERSON", "_targets", "_field_catalogue",
        "catalogue", "_resource_for",
    ),
    "run_view": ("_serialise", "_dialect", "_label_of", "_unmapped_required", "can_execute"),
    "runs": ("_fields", "_mine", "listing", "_row_for", "entry"),
    "wizard": ("begin", "_reference"),
    "mapping": ("map_columns", "_checked_mapping", "_validate"),
    "execution": ("execute", "_why_not", "run"),
    "outcomes": ("discard", "problems"),
})
