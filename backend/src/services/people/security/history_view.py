"""Trusting a device, and the sign-in history."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.clock import iso, now
from src.core.pagination import envelope, parse_page
from src.core.query import (
    Field,
    FieldSet,
    apply_filters,
    apply_sort,
    count_of,
    facets_for,
)
from src.models.identity import LoginEvent
from src.services.people.security.sessions_view import (
    HISTORY_DAYS,
    _own_session,
    _session,
)


def trust(session, ident: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Mark a device as one you recognise, or stop doing so.

    A note to yourself rather than a grant: nothing in the platform treats a
    trusted session differently, and saying so is the honest version. What it
    buys is the ability to scan the list and see the one you *do not*
    recognise, which is the whole reason somebody opens this page.
    """
    row = _own_session(session, ident, principal=principal)
    wanted = bool((payload or {}).get("trusted", True))

    if row.trusted != wanted:
        row.trusted = wanted
        audit.record(
            session,
            action="session.trust" if wanted else "session.untrust",
            resource_type="session",
            resource_id=row.id,
            resource_label=row.device or "session",
            principal=principal,
            after={"trusted": wanted},
        )
    session.commit()
    return _session(row, principal=principal)


def _history_fields() -> FieldSet:
    return FieldSet(
        Field("result", LoginEvent.result, kind="enum", label="Result", facet=True),
        Field("method", LoginEvent.method, kind="enum", label="Method", facet=True),
        Field("device", LoginEvent.device, kind="enum", label="Device", facet=True),
        Field("ip_address", LoginEvent.ip_address, label="Address", searchable=True),
        Field("created_at", LoginEvent.created_at, kind="datetime", label="When"),
    )


def history(session, args, *, principal) -> dict[str, Any]:
    """This account's recent sign-ins, successes and failures alike.

    Filtered and faceted in PostgreSQL, so "show me only the failures" is a
    query rather than a narrowing of the page in hand (§71).
    """
    fields = _history_fields()
    page = parse_page(args, default_sort="created_at")
    since = now() - timedelta(days=HISTORY_DAYS)

    statement = apply_filters(
        select(LoginEvent).where(
            LoginEvent.user_id == principal.user_id, LoginEvent.created_at >= since
        ),
        args,
        fields,
    )
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="created_at")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).all()

    return envelope(
        [
            {
                "id": str(row.id),
                "result": row.result,
                "reason": row.reason,
                "method": row.method,
                "device": row.device or "Unknown",
                "ip_address": row.ip_address,
                "location": row.location,
                "at": iso(row.created_at),
            }
            for row in rows
        ],
        total,
        page,
        facets=facets,
        fields=fields.describe(),
        window_days=HISTORY_DAYS,
    )
