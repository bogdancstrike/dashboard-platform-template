"""Report documents (§27): composed pages of blocks — text, charts, tables, metrics — rendered to PDF/DOCX.
See docs/architecture/backend/report-documents.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "vocabulary": (
        "KIND", "MANAGE_PERMISSION", "VIEW_PERMISSION", "SHARE_PERMISSION", "BLOCK_KINDS",
        "DATA_KINDS", "CHART_KINDS", "MAX_BLOCKS", "MAX_TABLE_ROWS", "DEFAULT_TABLE_ROWS",
        "PAGE_SIZES", "ORIENTATIONS", "SHOW_MODES", "FORMATS", "DEFAULT_PAGE", "STARTER_BLOCKS",
    ),
    "documents": ("listing", "get", "create", "update", "remove", "duplicate"),
    "rendering": ("render", "resolve"),
    "charts": ("_resolve_report", "_resolve_chart", "_measure_of", "_tabulate", "_number", "_why"),
    "tables": ("_resolve_table", "_resolve_metrics", "_metric", "_cell"),
    "page_settings": ("_page", "_is_hex"),
    "validation": ("_validated", "_blocks"),
    "serializers": (
        "_visible", "_owned", "_period_label", "_copy_name", "_slug", "_serialize", "_state",
    ),
    "composing": ("compose",),
})
