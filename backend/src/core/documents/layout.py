"""Page sizes, filenames, PNG decoding and fitting table columns."""

from __future__ import annotations

import base64
import re
from typing import Any

PAGE_SIZES = {"A4": "A4", "LETTER": "LETTER"}


#: How much vertical room a spacer asks for, in points.
SPACER_POINTS = {"small": 8, "medium": 20, "large": 40}


#: Columns past this and a portrait page is a grid of truncated words.
MAX_TABLE_COLUMNS = {"portrait": 6, "landscape": 9}


def content_type(fmt: str) -> str:
    return {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }[fmt]


def filename(stem: str, fmt: str) -> str:
    """A file name that survives being downloaded on any of three systems."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-").lower() or "document"
    return f"{cleaned[:80]}.{fmt}"


def decode_png(value: Any) -> bytes | None:
    """A `data:` URL from the browser, as bytes.

    Returns `None` rather than raising for anything that is not a PNG data
    URL: an image that did not arrive is a block that renders as a table, and
    a malformed one is the same situation with a worse cause.
    """
    if not isinstance(value, str):
        return None
    match = re.match(r"^data:image/(png|jpeg);base64,(.+)$", value.strip(), re.DOTALL)
    if not match:
        return None
    try:
        return base64.b64decode(match.group(2), validate=True)
    except Exception:
        return None


def fit_columns(columns: list[str], rows: list[list[str]], orientation: str) -> tuple[
    list[str], list[list[str]], int
]:
    """The first few columns, and how many were left behind.

    Dropping columns rather than shrinking the type: six-point text is not a
    smaller table, and the reader is told the number so they know the document
    is a summary of a wider set.
    """
    limit = MAX_TABLE_COLUMNS.get(orientation, 6)
    if len(columns) <= limit:
        return columns, rows, 0
    return columns[:limit], [row[:limit] for row in rows], len(columns) - limit
