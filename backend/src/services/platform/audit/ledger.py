"""The audit ledger: list and export."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Select, select

from src.core.audit import ACTIONS, RESULTS
from src.core.errors import ValidationError
from src.core.pagination import envelope, parse_page
from src.core.query import (
    Field,
    FieldSet,
    apply_filters,
    apply_sort,
    count_of,
    facets_for,
)
from src.services.platform.audit.serializers import summarise

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
    # Counted before a byte is written. This is the export the truncation was
    # first noticed on: 1042 rows arriving as 1001 one run and 1008 the next.
    # That cause was fixed; a *ceiling* silently cutting the file was not.
    writer.refuse_if_truncated(statement, fmt=fmt, what="audit entries")
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
