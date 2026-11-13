"""Reading a spreadsheet somebody exported from something else (§29).
See docs/architecture/backend/importer.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "sheets": (
        "DELIMITERS", "MAX_BYTES", "MAX_ROWS", "PREVIEW_ROWS", "_NOISE", "Dialect", "Column",
        "Sheet", "sniff", "name_of", "_first_line",
    ),
    "reading": ("read", "suggest", "_normal", "_without_bom", "_named", "_dialect_for"),
})
