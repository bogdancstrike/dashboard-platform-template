"""One gesture over many records (§43, §75).
See docs/architecture/backend/bulk.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "resolution": (
        "ACTIONS", "MAX_ROWS", "Selection", "_rows", "_refusals", "_missing_permission", "_object",
        "_uuids", "_action", "_changes",
    ),
    "outcomes": ("SAMPLE", "_plain", "_describes", "_outcome", "apply_rows"),
    "selection": ("parse_selection", "preview", "apply"),
})
