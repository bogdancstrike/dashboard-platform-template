"""A document's page settings: size, orientation, margins and colours."""

from __future__ import annotations

from typing import Any

from src.core.errors import ValidationError
from src.services.analytics.report_documents.vocabulary import (
    DEFAULT_PAGE,
    ORIENTATIONS,
    PAGE_SIZES,
)


def _page(raw: Any) -> dict[str, Any]:
    """The paper, checked so a renderer never has to guess.

    Clamped rather than refused, because every value here has a sane
    neighbour: a 400mm margin on an A4 page is not a decision worth a round
    trip, it is a slider somebody dragged too far.
    """
    if raw is not None and not isinstance(raw, dict):
        raise ValidationError("page must be an object.")
    given = dict(raw or {})
    page = dict(DEFAULT_PAGE)

    size = str(given.get("size") or page["size"]).upper()
    page["size"] = size if size in PAGE_SIZES else "A4"

    orientation = str(given.get("orientation") or page["orientation"]).lower()
    page["orientation"] = orientation if orientation in ORIENTATIONS else "portrait"

    try:
        margin = float(given.get("margin_mm", page["margin_mm"]))
    except (TypeError, ValueError):
        margin = float(page["margin_mm"])
    page["margin_mm"] = max(5.0, min(50.0, margin))

    for key in ("header", "footer", "subtitle"):
        page[key] = str(given.get(key) or "")[:160]

    page["page_numbers"] = bool(given.get("page_numbers", True))
    page["cover"] = bool(given.get("cover", True))

    accent = str(given.get("accent") or page["accent"]).strip()
    # A colour the renderer can actually parse. Anything else takes the
    # platform's own accent rather than failing a save somebody made by typing.
    page["accent"] = accent if _is_hex(accent) else DEFAULT_PAGE["accent"]
    return page


def _is_hex(value: str) -> bool:
    return (
        len(value) == 7
        and value.startswith("#")
        and all(character in "0123456789abcdefABCDEF" for character in value[1:])
    )
