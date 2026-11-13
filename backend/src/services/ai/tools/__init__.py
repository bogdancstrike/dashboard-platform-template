"""The read-only tools a Data-mode conversation may call (§41).
See docs/architecture/backend/tools.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "tool_definitions": (
        "MAX_ROWS", "_datasets", "catalogue_text", "DOCUMENT_TOOL", "definitions",
        "record_definitions", "_cite", "_tree", "search_records",
    ),
    "execution": (
        "count_records", "get_record", "global_search", "TOOLS", "search_documents", "run",
        "_summary",
    ),
})
