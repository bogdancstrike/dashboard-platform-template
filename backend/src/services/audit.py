"""The audit explorer (§21): who did what, when, and what changed.

Three things this answers, and they are deliberately three different reads:

* **The ledger** — a filtered, sorted, paged list of every recorded action,
  with facets so the filter menus are built from the data rather than from a
  hardcoded list that drifts.
* **One entry** — the field-level before → after diff, plus the request context
  (correlation id, address, agent) that makes a row investigable.
* **One record's timeline** — the same rows scoped to a single resource, which
  is what every entity detail page shows (§48).

The list is built on `core/query.py` for the same reason every other list is:
one declaration drives the SQL, the sort, the facets *and* the filter
vocabulary the frontend renders, so a filter the UI offers is by construction a
filter the backend honours.

Read-only by design. There is no create, no update and no delete here — an
audit trail somebody can edit is not an audit trail, and the only writer is
`core/audit.record`, which appends in the same transaction as the change it
describes.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import Select, select

from src.core.audit import ACTIONS, MASK, RESULTS, is_secret
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import Field, FieldSet, apply_filters, apply_sort, count_of, facets_for

#: The permission the ledger requires. The per-record timeline asks for less —
#: see `timeline` — because reading the history of a record you may already
#: read is not the same privilege as reading everything anybody has ever done.
LEDGER_PERMISSION = "audit.view"
TIMELINE_PERMISSION = "records.view"
#: Reading the ledger and taking a copy of it off the platform are two
#: different privileges, and the second is the one that leaves the building.
EXPORT_PERMISSION = "records.export"

#: A timeline is a detail-page panel, not a data export.
MAX_TIMELINE = 200


def _fields() -> FieldSet:
    """Built lazily so importing this module does not pull the models at boot."""
    from src.models.platform import AuditLog

    return FieldSet(
        Field("occurred_at", AuditLog.occurred_at, kind="datetime", label="When"),
        Field("action", AuditLog.action, kind="enum", facet=True, choices=ACTIONS),
        Field("result", AuditLog.result, kind="enum", facet=True, choices=RESULTS),
        Field("resource_type", AuditLog.resource_type, kind="enum", facet=True,
              label="Resource type"),
        Field("resource_id", AuditLog.resource_id, label="Resource ID"),
        Field("resource_label", AuditLog.resource_label, searchable=True, label="Resource"),
        Field("actor_label", AuditLog.actor_label, searchable=True, facet=True, label="Actor"),
        Field("actor_role", AuditLog.actor_role, kind="enum", facet=True, label="Actor role"),
        Field("actor_id", AuditLog.actor_id, kind="uuid", label="Actor ID"),
        Field("impersonated", AuditLog.impersonated, kind="bool", label="Impersonated"),
        Field("impersonator_label", AuditLog.impersonator_label, searchable=True,
              label="Impersonator"),
        Field("correlation_id", AuditLog.correlation_id, searchable=True, label="Correlation ID"),
        Field("ip_address", AuditLog.ip_address, facet=True, label="IP address"),
        Field("message", AuditLog.message, searchable=True),
        Field("changed_fields", AuditLog.changed_fields, kind="array", label="Changed fields"),
        Field("id", AuditLog.id, kind="uuid", label="Entry ID"),
    )


#: Columns the explorer shows before anybody configures it.
DEFAULT_COLUMNS = (
    "occurred_at", "actor_label", "action", "resource_type", "resource_label", "result",
)

#: What an export carries by default — the columns on screen, plus the three an
#: investigation needs and a table has no room for.
EXPORT_COLUMNS = (
    *DEFAULT_COLUMNS,
    "actor_role",
    "impersonator_label",
    "resource_id",
    "correlation_id",
    "message",
)


def _statement() -> Select:
    from src.models.platform import AuditLog

    return select(AuditLog)


def catalogue(session, *, principal) -> dict[str, Any]:
    """The filter vocabulary, from the same declaration the SQL is built from."""
    principal.require(LEDGER_PERMISSION)
    fields = _fields()
    return {
        "fields": fields.describe(),
        "default_columns": list(DEFAULT_COLUMNS),
        "default_sort": "occurred_at",
        "actions": list(ACTIONS),
        "results": list(RESULTS),
        "total": count_of(session, _statement()),
    }


def listing(session, args, *, principal) -> dict[str, Any]:
    """One page of the ledger, filtered and faceted in PostgreSQL (§71)."""
    principal.require(LEDGER_PERMISSION)
    fields = _fields()
    page = parse_page(args, default_sort="occurred_at")

    statement = apply_filters(_statement(), args, fields)
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="occurred_at")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).all()

    return envelope(
        [summarise(row) for row in rows],
        total,
        page,
        fields=fields.describe(),
        facets=facets,
        columns=list(DEFAULT_COLUMNS),
    )


def export(args, *, principal):
    """The ledger as a file, under exactly the filters on screen (§30).

    Deliberately *not* handed a session: the rows are streamed after this
    returns, so `core/export.stream_rows` opens one of its own. The statement
    is the same one `listing` builds, minus its page — which is what makes the
    file and the screen provably the same question.
    """
    principal.require(LEDGER_PERMISSION)
    principal.require(EXPORT_PERMISSION)
    from src.core import export as writer

    fields = _fields()
    fmt = writer.parse_format(args.get("format"))
    page = parse_page(args, default_sort="occurred_at")

    statement = apply_filters(_statement(), args, fields)
    statement = apply_sort(statement, page, fields, default="occurred_at")

    columns = [
        writer.Column(name, fields.by_name[name].title)
        for name in _export_columns(args, fields)
    ]
    rows = writer.stream_rows(statement, limit=writer.limit_for(fmt))
    return writer.response(
        (summarise(row) for row in rows), columns, fmt=fmt, stem="audit-log"
    )


def _export_columns(args, fields: FieldSet) -> list[str]:
    """The columns to write, defaulting to a row somebody can actually read.

    An export of every declared field is a spreadsheet with a horizontal
    scrollbar and no story; an export of the six on screen is the thing the
    reader was looking at.
    """
    raw = str(args.get("columns") or "").strip()
    if not raw:
        return list(EXPORT_COLUMNS)
    requested = [name.strip() for name in raw.split(",") if name.strip()]
    unknown = [name for name in requested if name not in fields.by_name]
    if unknown:
        raise ValidationError("Unknown export column.", details={"columns": unknown})
    return requested or list(EXPORT_COLUMNS)


def entry(session, entry_id: Any, *, principal) -> dict[str, Any]:
    """One entry, with the diff and the request context behind it."""
    principal.require(LEDGER_PERMISSION)
    from src.models.platform import AuditLog

    identifier = parse_uuid(entry_id, field="entry_id")
    row = session.get(AuditLog, identifier)
    if row is None:
        raise NotFoundError("That audit entry does not exist.")
    return detail(row)


def timeline(session, args, *, principal) -> dict[str, Any]:
    """Every recorded action against one record, newest first (§21, §48).

    Scoped to a single resource on purpose: this is the panel an entity detail
    page shows, and an endpoint that accepts "no resource" would quietly be the
    whole ledger behind a lesser permission.
    """
    principal.require(TIMELINE_PERMISSION)
    from src.models.platform import AuditLog

    resource_type = str(args.get("resource_type") or "").strip()
    resource_id = str(args.get("resource_id") or "").strip()
    if not resource_type or not resource_id:
        raise ValidationError(
            "A timeline needs both resource_type and resource_id.",
            details={"resource_type": resource_type, "resource_id": resource_id},
        )

    try:
        limit = int(args.get("limit", 50))
    except (TypeError, ValueError) as exc:
        raise ValidationError("limit must be an integer") from exc
    if limit < 1 or limit > MAX_TIMELINE:
        raise ValidationError(f"limit must be between 1 and {MAX_TIMELINE}")

    statement = (
        _statement()
        .where(AuditLog.resource_type == resource_type, AuditLog.resource_id == resource_id)
        .order_by(AuditLog.occurred_at.desc())
    )
    total = count_of(session, statement)
    rows = session.scalars(statement.limit(limit)).all()

    return {
        "items": [detail(row) for row in rows],
        "total": total,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "limit": limit,
    }


# ── serialization ────────────────────────────────────────────────────────


def summarise(row) -> dict[str, Any]:
    """A ledger row: who / when / what, at a glance.

    The diff is deliberately *not* here — a page of twenty-five rows would
    otherwise carry twenty-five before-and-after documents to render six
    columns. `changed_field_count` is what the list actually needs.
    """
    return {
        "id": str(row.id),
        "occurred_at": _json(row.occurred_at),
        "action": row.action,
        "result": row.result,
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "resource_label": row.resource_label or "",
        "actor_id": str(row.actor_id) if row.actor_id else None,
        "actor_label": row.actor_label or "System",
        "actor_role": row.actor_role or "",
        "impersonated": bool(row.impersonated),
        "impersonator_label": row.impersonator_label or "",
        "correlation_id": row.correlation_id or "",
        "message": row.message or "",
        "changed_field_count": len(row.changed_fields or []),
    }


def detail(row) -> dict[str, Any]:
    """One entry in full: the summary, the request context, and the diff.

    The diff is served as a list rather than an object so the order is the
    server's to choose and the client renders what it is given. A browser that
    re-derives a diff from two documents is a second implementation of
    `core/audit.diff`, and the two will disagree about something eventually.
    """
    return {
        **summarise(row),
        "ip_address": row.ip_address or "",
        "user_agent": row.user_agent or "",
        "organization_id": str(row.organization_id) if row.organization_id else None,
        "metadata": _mask(row.metadata_json),
        # Masked again on the way out, though `core/audit.record` already
        # masked on the way in (§76). Redacting in one place makes the property
        # true of one writer; redacting here makes it true of the endpoint, and
        # the endpoint is what a row written by a migration, a fixture or a
        # future second writer has to pass through.
        "state_before": _mask(row.state_before),
        "state_after": _mask(row.state_after),
        "changed_fields": list(row.changed_fields or []),
        "changes": [
            {
                "field": name,
                "from": MASK if is_secret(name) else _json(change.get("from")),
                "to": MASK if is_secret(name) else _json(change.get("to")),
                # "added" and "cleared" are different events and the drawer has
                # to be able to tell them apart (§21). Comparing two rendered
                # strings cannot: a field set to "" and a field removed both
                # render as nothing.
                "kind": _change_kind(change),
            }
            for name, change in sorted((row.changes or {}).items())
            if isinstance(change, dict)
        ],
    }


def _change_kind(change: dict[str, Any]) -> str:
    before, after = change.get("from"), change.get("to")
    if _absent(before) and not _absent(after):
        return "added"
    if not _absent(before) and _absent(after):
        return "cleared"
    return "changed"


def _mask(payload: Any) -> dict[str, Any]:
    """A stored JSON document, with secret-shaped keys blanked."""
    if not isinstance(payload, dict):
        return {}
    return {key: (MASK if is_secret(key) else _json(value)) for key, value in payload.items()}


def _absent(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def _json(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {key: _json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json(item) for item in value]
    return value
