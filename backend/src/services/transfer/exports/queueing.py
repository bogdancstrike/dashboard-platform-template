"""Queueing an export, and queueing one again."""

from __future__ import annotations

from typing import Any

from src.core import audit, background
from src.core.errors import ConflictError, ValidationError
from src.core.query import count_of
from src.models.platform import BackgroundJob
from src.services.records import explorer
from src.services.transfer.exports.policy import (
    _PENDING,
    KIND,
    MAX_PENDING_PER_PERSON,
    PERMISSION,
    QUEUE,
    _line,
    _reference,
    max_rows,
    retention_days,
    stalled,
)
from src.services.transfer.exports.producing import run
from src.services.transfer.exports.reading import _mine, _row_for, _serialise


def queue(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Accept an export, and start producing it off the request.

    The count happens here, before the row is written, so an export that
    cannot be produced is refused with the number rather than accepted and
    failed later. `total_units` is that count: a progress bar over a total
    nobody measured is decoration.
    """
    principal.require(PERMISSION)
    plan = explorer.plan_for(payload, principal=principal)

    # Counted in Python over the pending rows rather than in SQL, because
    # "stalled" is derived from a clock and a threshold: a `WHERE created_at >
    # now() - interval` would be the same rule spelled a second way, and the
    # one that would drift is whichever a reader trusted.
    waiting = [
        row
        for row in session.scalars(_mine(principal).where(BackgroundJob.status.in_(_PENDING)))
        if not stalled(row)
    ]
    pending = len(waiting)
    if pending >= MAX_PENDING_PER_PERSON:
        raise ConflictError(
            f"You already have {pending} exports in progress, which is the limit. "
            "Wait for one to finish, or discard it.",
            details={
                "pending": pending,
                "maximum": MAX_PENDING_PER_PERSON,
                "references": [row.reference for row in waiting],
            },
        )

    total = count_of(session, explorer.statement_of(plan))
    ceiling = max_rows(session)
    if total > ceiling:
        raise ValidationError(
            f"That is {total:,} rows, and this installation exports at most "
            f"{ceiling:,}. Narrow the query, or raise limits.max_export_rows.",
            details={"total": total, "maximum": ceiling, "setting": "limits.max_export_rows"},
        )

    row = BackgroundJob(
        reference=_reference(session),
        name=f"{plan.resource.label} — {plan.fmt.upper()}",
        kind=KIND,
        queue=QUEUE,
        status="QUEUED",
        priority="NORMAL",
        progress=0,
        total_units=total,
        processed_units=0,
        failed_units=0,
        attempt=1,
        # One attempt: a failed export is re-requested, not retried. Retrying
        # would re-run the same query against rows that have since changed, and
        # hand somebody a file whose name says one moment and whose contents
        # say another.
        max_attempts=1,
        initiated_by_id=principal.user_id,
        initiated_by_label=principal.full_name,
        organization_id=principal.organization_id,
        payload=plan.stored(),
        log_lines=[_line("accepted", f"{total:,} rows to write")],
    )
    session.add(row)
    session.flush()

    audit.record(
        session,
        action="export.queue",
        resource_type="export",
        resource_id=row.id,
        resource_label=row.reference,
        principal=principal,
        # The query, not its results: an audit row that carried the rows would
        # be a second copy of the data the export is already a copy of.
        after={
            "rows": total,
            "format": plan.fmt,
            "resource": plan.resource_type,
            "question": plan.describe(),
        },
    )
    session.commit()

    # Spawned after the commit, or the job would look for a row that is still
    # inside this transaction.
    job_id = row.id
    mechanism = background.spawn(lambda: run(job_id), name=f"export:{row.reference}")

    # Re-read, because the answer depends on which mechanism ran it and this
    # response should say what is true rather than what was true a moment ago:
    # a greenlet has not started yet and the row is genuinely QUEUED, while
    # `synchronous()` has already finished and the row is SUCCEEDED. Reporting
    # QUEUED in both cases would make the page poll for a file that is there.
    session.refresh(row)
    return {**_serialise(row, days=retention_days(session)), "ran_as": mechanism}


def again(session, ident: Any, *, principal) -> dict[str, Any]:
    """Queue a *new* export from an existing one's stored question.

    Not a retry, deliberately, and this is the difference worth being precise
    about: retrying would re-run the old job in place, and the rows have moved
    on since it was asked for — a file whose reference says one moment and
    whose contents say another is worse than no file. So this reads the plan
    off the old row and asks the question again, now: a new reference, a new
    file, and the old record left exactly as it was.

    It is what the page offers on a failed export and on a stalled one, which
    is the same offer for the same reason.
    """
    principal.require(PERMISSION)
    row = _row_for(session, ident, principal=principal)
    # Validated through the ordinary path, so a plan whose columns no longer
    # exist is refused here rather than inside the background job.
    return queue(session, dict(row.payload or {}), principal=principal)
