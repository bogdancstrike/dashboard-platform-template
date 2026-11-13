"""Turning a composed document into a file somebody can send (§28, §30).
See docs/architecture/backend/documents.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "layout": (
        "PAGE_SIZES", "SPACER_POINTS", "MAX_TABLE_COLUMNS", "content_type", "filename",
        "decode_png", "fit_columns",
    ),
    "pdf": ("render_pdf",),
    "docx": ("_escape", "render_docx", "_quiet", "_caption", "_page_number_field"),
})
