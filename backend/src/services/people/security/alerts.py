"""Security events, and resolving them."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit, vocabulary
from src.core.clock import iso
from src.core.errors import NotFoundError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import (
    Field,
    FieldSet,
    apply_filters,
    apply_sort,
    count_of,
    facets_for,
)
from src.models.identity import SecurityEvent


def events(session, args, *, principal) -> dict[str, Any]:
    """What the platform has noticed about this account."""
    fields = FieldSet(
        Field("kind", SecurityEvent.kind, kind="enum", label="Kind", facet=True),
        Field("severity", SecurityEvent.severity, kind="enum", label="Severity", facet=True,
              choices=vocabulary.SECURITY_SEVERITY),
        Field("resolved", SecurityEvent.resolved, kind="bool", label="Resolved", facet=True),
        Field("title", SecurityEvent.title, label="What", searchable=True),
        Field("created_at", SecurityEvent.created_at, kind="datetime", label="When"),
    )
    page = parse_page(args, default_sort="created_at")

    statement = apply_filters(
        select(SecurityEvent).where(SecurityEvent.user_id == principal.user_id), args, fields
    )
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="created_at")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).all()

    return envelope(
        [_event(row) for row in rows],
        total,
        page,
        facets=facets,
        fields=fields.describe(),
    )


def _event(row) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "kind": row.kind,
        "severity": row.severity,
        "title": row.title,
        "description": row.description,
        "ip_address": row.ip_address,
        "resolved": row.resolved,
        "at": iso(row.created_at),
        "details": dict(row.metadata_json or {}),
    }


def resolve(session, ident: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Mark an event as dealt with — or as not, if it was pressed by mistake.

    Reversible, and *not* a delete. "I have seen this and it was me" is the
    common case and worth being able to record; losing the row would leave the
    page unable to answer "was this ever looked at".
    """
    row = session.get(SecurityEvent, parse_uuid(ident, field="event id"))
    if row is None or row.user_id != principal.user_id:
        raise NotFoundError("That event does not exist.", details={"id": str(ident)})

    wanted = bool((payload or {}).get("resolved", True))
    if row.resolved != wanted:
        row.resolved = wanted
        audit.record(
            session,
            action="security_event.resolve" if wanted else "security_event.reopen",
            resource_type="security_event",
            resource_id=row.id,
            resource_label=row.title,
            principal=principal,
            after={"resolved": wanted},
        )
    session.commit()
    return _event(row)
