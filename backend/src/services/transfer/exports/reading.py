"""The reader's exports: the list and one export."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Select, select

from src.core import vocabulary
from src.core.clock import iso
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import (
    Field,
    FieldSet,
    apply_filters,
    apply_sort,
    count_of,
    facets_for,
)
from src.models.platform import BackgroundJob
from src.services.records import explorer
from src.services.transfer.exports.policy import (
    KIND,
    PERMISSION,
    _expired,
    expires_at,
    retention_days,
    stalled,
)


def _fields() -> FieldSet:
    """What an export list can be filtered and sorted by.

    Deliberately short. This is somebody's own small list of recent requests,
    not a dataset — a facet panel over four rows is furniture, not a feature.
    """
    return FieldSet(
        Field("reference", BackgroundJob.reference, label="Reference", searchable=True),
        Field("name", BackgroundJob.name, label="Export", searchable=True),
        Field("status", BackgroundJob.status, kind="enum", label="Status", facet=True,
              choices=vocabulary.JOB_STATUS),
        Field("created_at", BackgroundJob.created_at, kind="datetime", label="Requested"),
        Field("finished_at", BackgroundJob.finished_at, kind="datetime", label="Finished"),
    )


def _mine(principal) -> Select:
    """This person's exports, and nobody else's. See the module note."""
    return select(BackgroundJob).where(
        BackgroundJob.kind == KIND,
        BackgroundJob.initiated_by_id == principal.user_id,
    )


def _serialise(row, *, days: int) -> dict[str, Any]:
    """One export as the page reads it.

    Everything about the file is taken from `result`, which the run wrote from
    the object it actually stored — never from the request that asked for it.
    An export row that reports the row count somebody hoped for is the defect
    the seeded rows used to carry.
    """
    result = row.result or {}
    payload = row.payload or {}
    stored_rows = result.get("rows")
    expiry = expires_at(row, days)
    gone = _expired(row, days)
    stuck = stalled(row)

    return {
        "id": str(row.id),
        "reference": row.reference,
        "name": row.name,
        "status": row.status,
        "resource_type": payload.get("resource_type") or "",
        "format": payload.get("format") or "",
        "description": _describe(payload),
        "columns": list(payload.get("columns") or []),
        "rows": int(stored_rows) if isinstance(stored_rows, int) else None,
        "size_bytes": result.get("size_bytes"),
        "checksum": result.get("checksum"),
        "requested_at": iso(row.created_at),
        "started_at": iso(row.started_at),
        "finished_at": iso(row.finished_at),
        "duration_ms": row.duration_ms,
        "progress": row.progress,
        "attempt": row.attempt,
        "max_attempts": row.max_attempts,
        "error_message": row.error_message,
        # Which of `core/background`'s mechanisms produced it, so a slow export
        # can be read for what it is rather than guessed at.
        "ran_as": result.get("ran_as") or "",
        "expires_at": iso(expiry) if expiry else None,
        "expired": gone,
        # Pending for longer than anything could plausibly still be running.
        # Said out loud rather than shown as a spinner that never stops.
        "stalled": stuck,
        # Derived from the row rather than from a `stat` per line: a page of
        # twenty-five would otherwise be twenty-five round trips to object
        # storage. The download verifies for real, because it has to anyway.
        "downloadable": bool(result.get("artifact")) and not gone and row.status == "SUCCEEDED",
        # Whether there is a file *at all*, which is not the same question.
        # `forget` takes two presses and this is what decides which press the
        # next one is — and it has to be said rather than inferred, because
        # `rows` and `size_bytes` survive a discard: "1,284 rows, 88 KB" is the
        # history the record exists to keep. A page guessing from `size_bytes`
        # got the second press wrong, and only the real stack showed it.
        "has_file": bool(result.get("artifact")),
        "log_lines": list(row.log_lines or []),
    }


def _describe(payload: dict[str, Any]) -> str:
    """The stored question in a sentence, or why it cannot be read.

    Re-derived from the resource's field catalogue every time rather than
    stored beside the plan: a description saved at queue time is a second copy
    of the query that starts being wrong as soon as a field is relabelled.
    """
    try:
        return explorer.replan(payload).describe()
    except ValidationError:
        # A resource or column that no longer exists. Worth saying plainly:
        # the row is still a record of what somebody asked for.
        return "This export's query refers to fields that no longer exist."


def listing(session, args, *, principal) -> dict[str, Any]:
    """One page of my exports, newest first."""
    principal.require(PERMISSION)
    fields = _fields()
    page = parse_page(args, default_sort="created_at")

    statement = apply_filters(_mine(principal), args, fields)
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="created_at")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).all()

    days = retention_days(session)
    return envelope(
        [_serialise(row, days=days) for row in rows],
        total,
        page,
        facets=facets,
        fields=fields.describe(),
        columns=["reference", "name", "status", "rows", "created_at"],
    )


def _row_for(session, ident: Any, *, principal) -> BackgroundJob:
    """One of my exports, or a 404 that does not say whose it was.

    A "that belongs to somebody else" message is a way to confirm a reference
    exists, so an export that is not mine is one that is not there.
    """
    row = session.get(BackgroundJob, parse_uuid(ident, field="export id"))
    if row is None or row.kind != KIND or row.initiated_by_id != principal.user_id:
        raise NotFoundError("That export does not exist.", details={"id": str(ident)})
    return row


def entry(session, ident: Any, *, principal) -> dict[str, Any]:
    """One export, with its log lines."""
    principal.require(PERMISSION)
    return _serialise(_row_for(session, ident, principal=principal), days=retention_days(session))
