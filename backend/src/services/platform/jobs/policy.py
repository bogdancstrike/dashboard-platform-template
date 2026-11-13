"""Job permissions, columns, and what may be retried, cancelled or re-attempted."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Select, func, select

from src.core import vocabulary
from src.core.clock import iso
from src.core.query import Field, FieldSet, count_of

#: Reading the queue: what ran, and what it did.
VIEW_PERMISSION = "jobs.view"


#: Acting on it. Separate because a retry re-runs work against real rows.
MANAGE_PERMISSION = "jobs.manage"


#: The most attempts an operator may grant one job.
#:
#: A bound on the bound, because "retry until it works" is how a broken job
#: becomes a broken job that has written the same rows forty times. Ten is
#: generous for a real backlog and still a number somebody has to mean.
MAX_ALLOWED_ATTEMPTS = 10


#: How many inline log lines one job's detail returns. They are stored on the
#: row as JSON so the drawer needs no join; a runaway job could still carry
#: thousands, and a drawer is not a log viewer — `/admin/logs` is.
MAX_LOG_LINES = 200


def _fields() -> FieldSet:
    """Built lazily so importing this module does not pull the models at boot."""
    from src.models.platform import BackgroundJob

    return FieldSet(
        Field("created_at", BackgroundJob.created_at, kind="datetime", label="Queued"),
        Field("reference", BackgroundJob.reference, searchable=True, label="Reference"),
        Field("name", BackgroundJob.name, searchable=True),
        Field("kind", BackgroundJob.kind, kind="enum", facet=True, choices=vocabulary.JOB_KIND),
        # The queue is *not* a closed set — a deployment adds queues — so it is
        # faceted from the data rather than declared with choices.
        Field("queue", BackgroundJob.queue, kind="enum", facet=True),
        Field("status", BackgroundJob.status, kind="enum", facet=True,
              choices=vocabulary.JOB_STATUS),
        Field("priority", BackgroundJob.priority, kind="enum", facet=True,
              choices=vocabulary.PRIORITY),
        Field("progress", BackgroundJob.progress, kind="number"),
        Field("attempt", BackgroundJob.attempt, kind="number"),
        Field("duration_ms", BackgroundJob.duration_ms, kind="number", label="Duration (ms)"),
        Field("started_at", BackgroundJob.started_at, kind="datetime", label="Started"),
        Field("finished_at", BackgroundJob.finished_at, kind="datetime", label="Finished"),
        Field("initiated_by_label", BackgroundJob.initiated_by_label, searchable=True,
              facet=True, label="Started by"),
        Field("error_message", BackgroundJob.error_message, searchable=True, label="Error"),
        Field("id", BackgroundJob.id, kind="uuid", label="Job ID"),
    )


#: What the table shows before anybody configures it. `attempt` earns its place
#: because "failed" and "failed three times" are different problems.
DEFAULT_COLUMNS = ("created_at", "reference", "name", "status", "progress", "attempt")


def _statement() -> Select:
    from src.models.platform import BackgroundJob

    return select(BackgroundJob)


#: Job kinds this console will not retry, because something else owns them.
#:
#: An export (§30) is the only one so far, and the reason is a decision made in
#: `services/exports`: a retry would re-run the stored query against rows that
#: have moved on since it was asked for, and hand somebody a file whose
#: reference says one moment and whose contents say another. `/exports` offers
#: "Request again" instead, which produces a new export and leaves the old
#: record alone. Two screens offering opposite answers about the same row is
#: the defect this constant exists to prevent.
NOT_OURS_TO_RETRY: dict[str, str] = {
    "EXPORT": "Exports are re-requested rather than retried, on /exports.",
    # The document row holds the reading's state; reprocessing it from its
    # collection re-queues both, where a retry here would move only the job.
    "INGEST": "Documents are reprocessed from their collection, on /ai/documents.",
}


def can_retry(row) -> bool:
    """Whether this job may be tried again.

    Three conditions. Only a *terminal* job can be retried — retrying a RUNNING
    one puts two runs on the same rows, which is how a queue console corrupts
    what it supervises. Only within `max_attempts`, or the bound the model
    declares is one nothing enforces. And only a kind this console owns: see
    `NOT_OURS_TO_RETRY`.

    A pure function of the row so the API, the page and the test all get the
    same answer from the same rule: a button that offers a retry the server
    refuses is worse than no button.
    """
    return (
        row.kind not in NOT_OURS_TO_RETRY
        and row.status in vocabulary.JOB_TERMINAL
        and row.attempt < row.max_attempts
    )


def can_cancel(row) -> bool:
    """Whether this job may be stopped. Only one that has not finished."""
    return row.status in vocabulary.JOB_CANCELLABLE


def can_allow_attempts(row) -> bool:
    """Whether this job could be granted more attempts.

    Offered only where it would change something: a job with attempts to spare
    does not need more, and one already at the ceiling cannot have them. So the
    control appears exactly where the retry refusal points at it.
    """
    return row.attempt >= row.max_attempts and row.max_attempts < MAX_ALLOWED_ATTEMPTS


def summarise(row) -> dict[str, Any]:
    """One job, as a table row.

    Carries `can_retry`, `can_cancel` and `can_allow_attempts` rather than
    leaving the browser to re-derive them: the rules live in one place, and a
    page that computed them itself would eventually disagree with the endpoint
    that enforces them.
    """
    return {
        "id": str(row.id),
        "reference": row.reference,
        "name": row.name,
        "kind": row.kind,
        "queue": row.queue,
        "status": row.status,
        "priority": row.priority,
        "progress": int(row.progress or 0),
        "total_units": int(row.total_units or 0),
        "processed_units": int(row.processed_units or 0),
        "failed_units": int(row.failed_units or 0),
        "attempt": int(row.attempt or 1),
        "max_attempts": int(row.max_attempts or 1),
        "started_at": iso(row.started_at),
        "finished_at": iso(row.finished_at),
        "scheduled_for": iso(row.scheduled_for),
        "duration_ms": int(row.duration_ms) if row.duration_ms is not None else None,
        "initiated_by_label": row.initiated_by_label,
        "error_message": row.error_message,
        "created_at": iso(row.created_at),
        "can_retry": can_retry(row),
        "can_cancel": can_cancel(row),
        "can_allow_attempts": can_allow_attempts(row),
    }


def catalogue(session, *, principal) -> dict[str, Any]:
    """The filter vocabulary and the counts the status strip shows."""
    principal.require(VIEW_PERMISSION)
    from src.models.platform import BackgroundJob

    fields = _fields()
    counted = dict(
        session.execute(
            select(BackgroundJob.status, func.count()).group_by(BackgroundJob.status)
        ).all()
    )
    return {
        "fields": fields.describe(),
        "default_columns": list(DEFAULT_COLUMNS),
        "default_sort": "created_at",
        # Every declared status, including the ones at nought: a filter that
        # appeared only once something broke is one people stop looking for.
        "statuses": [
            {"key": status, "count": int(counted.get(status, 0))}
            for status in vocabulary.JOB_STATUS
        ],
        "kinds": list(vocabulary.JOB_KIND),
        "total": count_of(session, _statement()),
        # What this reader may do, so the page can decide once rather than
        # per row whether to draw the controls at all.
        "can_manage": principal.can(MANAGE_PERMISSION),
    }
