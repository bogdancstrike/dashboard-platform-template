"""Row lookups that answer 404 the same way everywhere.

Fifty-odd services repeated `row = session.get(...); if row is None: raise
NotFoundError(...)`, a few of them forgetting that a soft-deleted row is as
missing as an absent one. These helpers are that idiom, once.
"""

from __future__ import annotations

from typing import Any, TypeVar

from src.core.errors import NotFoundError

T = TypeVar("T")


def is_missing(row: Any, *, live: bool = False) -> bool:
    """Absent, or — when `live` — soft-deleted (`deleted_at` set)."""
    if row is None:
        return True
    return live and getattr(row, "deleted_at", None) is not None


def found_or_404(row: T | None, message: str, *, live: bool = False,
                 details: dict[str, Any] | None = None) -> T:
    """`row` itself, or the 404 a missing one deserves."""
    if is_missing(row, live=live):
        raise NotFoundError(message, details=details)
    return row  # type: ignore[return-value]


def get_or_404(session, model: type[T], key: Any, message: str, *, live: bool = False,
               details: dict[str, Any] | None = None) -> T:
    """`session.get(model, key)`, or a `NotFoundError(message)`.

    The key is used as given: parse a path parameter with
    `core.pagination.parse_uuid` first, so a malformed id stays a 400.
    """
    return found_or_404(session.get(model, key), message, live=live, details=details)
