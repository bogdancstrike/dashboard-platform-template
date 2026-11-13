"""Exports (§30): CSV, JSON and XLSX of *the current question*.
See docs/architecture/backend/export.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "cells": (
        "FORMATS", "MAX_ROWS", "MAX_XLSX_ROWS", "BATCH", "_FORMULA_PREFIXES", "Column",
        "parse_format", "limit_for", "filename", "cell", "defuse", "_row_values",
    ),
    "writers": ("csv_lines", "json_lines", "xlsx_bytes"),
    "delivery": ("write_to", "CONTENT_TYPES", "response", "refuse_if_truncated", "stream_rows"),
})
