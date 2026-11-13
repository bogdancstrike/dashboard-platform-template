"""The jobs list, one job, and retrying."""

from __future__ import annotations

from typing import Any

from src.core import audit, vocabulary
from src.core.clock import iso, now
from src.core.errors import ConflictError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import apply_filters, apply_sort, count_of, facets_for
from src.core.repository import get_or_404
from src.services.platform.jobs.policy import (
    DEFAULT_COLUMNS,
    MANAGE_PERMISSION,
    MAX_ALLOWED_ATTEMPTS,
    MAX_LOG_LINES,
    NOT_OURS_TO_RETRY,
    VIEW_PERMISSION,
    _fields,
    _statement,
    summarise,
)


def listing(session, args, *, principal) -> dict[str, Any]:
    """One page of the queue, filtered and faceted in PostgreSQL (§71)."""
    principal.require(VIEW_PERMISSION)
    fields = _fields()
    page = parse_page(args, default_sort="created_at")

    statement = apply_filters(_statement(), args, fields)
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="created_at")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).all()

    return envelope(
        [summarise(row) for row in rows],
        total,
        page,
        fields=fields.describe(),
        facets=facets,
        columns=list(DEFAULT_COLUMNS),
        can_manage=principal.can(MANAGE_PERMISSION),
    )


def entry(session, job_id: str, *, principal) -> dict[str, Any]:
    """One job in full: its payload, its result and its own log lines."""
    principal.require(VIEW_PERMISSION)

    row = _job(session, job_id)
    return {
        **summarise(row),
        "payload": row.payload or {},
        "result": row.result or None,
        # Capped: a drawer is not a log viewer, and a runaway job's inline
        # lines would otherwise be the whole response.
        "log_lines": (row.log_lines or [])[:MAX_LOG_LINES],
        "log_truncated": len(row.log_lines or []) > MAX_LOG_LINES,
        "scheduled_task_id": str(row.scheduled_task_id) if row.scheduled_task_id else None,
        # So the drawer can send somebody to the request that started it.
        "correlation_hint": row.reference,
    }


def _job(session, job_id: str):
    from src.models.platform import BackgroundJob

    row = get_or_404(
        session, BackgroundJob, parse_uuid(job_id, field="id"), "That job does not exist."
    )
    return row


def retry(session, job_id: str, *, principal) -> dict[str, Any]:
    """Queue this job for another attempt.

    The same row, not a new one: `attempt` goes up and the outcome is cleared,
    so `attempt 3 of 3` stays a fact somebody can read. A fresh row per retry
    would lose the connection between them and count one failure three times.

    Refused with the reason rather than silently ignored — a queue that appears
    to accept a retry and does nothing is worse than one that says no.
    """
    principal.require(VIEW_PERMISSION, MANAGE_PERMISSION)
    row = _job(session, job_id)

    if row.kind in NOT_OURS_TO_RETRY:
        raise ConflictError(
            f"{row.reference} is an {row.kind.lower()} and this console does not "
            f"retry those. {NOT_OURS_TO_RETRY[row.kind]}",
            details={"kind": row.kind, "instead": NOT_OURS_TO_RETRY[row.kind]},
        )
    if row.status not in vocabulary.JOB_TERMINAL:
        raise ConflictError(
            f"{row.reference} is {row.status.lower()} and has not finished — "
            "retrying it would run it twice over the same records.",
            details={"status": row.status, "retryable_from": list(vocabulary.JOB_TERMINAL)},
        )
    if row.attempt >= row.max_attempts:
        raise ConflictError(
            f"{row.reference} has used all {row.max_attempts} of its attempts. "
            "Grant it more if it should be tried again.",
            details={
                "attempt": row.attempt,
                "max_attempts": row.max_attempts,
                # Named so the refusal points at something that exists.
                "may_grant_up_to": MAX_ALLOWED_ATTEMPTS,
            },
        )

    before = {"status": row.status, "attempt": row.attempt}
    row.attempt += 1
    row.status = "QUEUED"
    row.progress = 0
    row.processed_units = 0
    row.failed_units = 0
    row.started_at = None
    row.finished_at = None
    row.duration_ms = None
    row.error_message = None
    row.result = None
    row.scheduled_for = now()
    # Appended rather than replaced: the previous attempt's lines are the
    # evidence of why this retry exists.
    row.log_lines = [
        *(row.log_lines or []),
        {
            "at": iso(now()),
            "level": "INFO",
            "message": f"attempt {row.attempt} queued by {principal.full_name or principal.username}",
        },
    ]

    audit.record(
        session,
        action="UPDATE",
        resource_type="background_job",
        resource_id=row.id,
        resource_label=row.reference,
        principal=principal,
        before=before,
        after={"status": row.status, "attempt": row.attempt},
        message=f"queued attempt {row.attempt} of {row.reference}",
    )
    session.flush()
    return summarise(row)
