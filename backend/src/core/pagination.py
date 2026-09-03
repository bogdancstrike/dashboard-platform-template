"""Page/size pagination plus a cursor mode, shared by every list endpoint.

Two strategies because the UI needs two (§52): numbered pagination for tables
where "page 7 of 42" is meaningful, and a keyset cursor for the infinite-scroll
and load-more feeds, where OFFSET 40000 is a sequential scan the user pays for.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any

MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 25
PAGE_SIZE_CHOICES = (10, 25, 50, 100, 200)


@dataclass(slots=True)
class Page:
    page: int
    page_size: int
    sort: str
    order: str

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def parse_page(args, *, default_sort: str, default_order: str = "desc") -> Page:
    from src.core.errors import ValidationError

    try:
        page = max(1, int(args.get("page", 1)))
        page_size = int(args.get("page_size", DEFAULT_PAGE_SIZE))
    except (TypeError, ValueError) as exc:
        raise ValidationError("page and page_size must be integers") from exc

    if page_size < 1 or page_size > MAX_PAGE_SIZE:
        raise ValidationError(f"page_size must be between 1 and {MAX_PAGE_SIZE}")

    order = (args.get("order") or default_order).lower()
    if order not in ("asc", "desc"):
        raise ValidationError("order must be 'asc' or 'desc'")

    return Page(page=page, page_size=page_size, sort=args.get("sort") or default_sort, order=order)


def envelope(items: list[Any], total: int, page: Page, **extra: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "items": items,
        "total": total,
        "page": page.page,
        "page_size": page.page_size,
        "pages": max(1, (total + page.page_size - 1) // page.page_size),
        "sort": page.sort,
        "order": page.order,
    }
    body.update(extra)
    return body


def encode_cursor(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, default=str, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    from src.core.errors import ValidationError

    padded = token + "=" * (-len(token) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
    except Exception as exc:
        raise ValidationError("cursor is not a valid pagination token") from exc


def parse_uuid(value: str, *, field: str = "id"):
    """Validate a path parameter before it reaches SQL.

    An arbitrary string in a UUID comparison makes PostgreSQL raise
    `invalid input syntax for type uuid`, which surfaces as a 500 for what is
    plainly a client error.
    """
    from uuid import UUID

    from src.core.errors import ValidationError

    try:
        return UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{field} must be a UUID", details={field: str(value)}) from exc
