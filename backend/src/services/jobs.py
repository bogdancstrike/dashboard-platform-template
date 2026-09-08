"""The background job queue (§23): what ran, what failed, what can be tried again.

Read like the log, written like a control panel — and the writes are the point.
`jobs.view` reads; `jobs.manage` retries and cancels, and those two verbs are
where every decision in this module lives.

Four decisions worth stating.

**Retry and cancel are gated on the *state*, not on the permission alone.** A
job that is still running cannot be retried, because retrying it would put two
runs on the same rows — the commonest way a queue console corrupts the data it
was built to supervise. `JOB_TERMINAL` and `JOB_CANCELLABLE` in
`core/vocabulary` are the two sets that decide it, and both are named in the
refusal so a disabled button can say why (§76).

**Not every kind is this console's to retry.** An export is re-*requested*
rather than retried, because its stored query would run against rows that have
moved on — `NOT_OURS_TO_RETRY` names the kinds and the refusal names where the
right action lives. Two screens giving opposite answers about the same row is
worse than either answer.

**A retry is a new attempt on the same job, not a new job.** `attempt` goes up,
the outcome fields are cleared, and the history is kept: `attempt 3 of 3` is the
fact an operator needs, and a queue that made a fresh row per retry would lose
the connection between them and count one failure as three.

**`max_attempts` is a real bound, and a raisable one.** A job that has used its
attempts is refused with the number named — and `allow_attempts` is how an
operator grants more, deliberately and audited. The refusal said "raise the
limit if it should be tried again" before there was any way to do that, which
is the worst kind of error message: one that names a fix the product does not
offer. Itself bounded by `MAX_ALLOWED_ATTEMPTS`, because "retry until it works"
is how a broken job writes the same rows forty times.

**A cancel is not a delete.** The row stays, CANCELLED, with who stopped it and
when — a queue whose cancelled jobs vanish cannot answer "why did the nightly
export not run last Tuesday", which is the question it gets asked.

There is no create. Nothing in the platform enqueues a job yet: `/exports`
(§30) is where that belongs, and the honest state of affairs is recorded rather
than papered over with a "New job" button that would only ever write a row no
worker reads.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Select, func, select

from src.core import audit, vocabulary
from src.core.clock import iso, now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import Field, FieldSet, apply_filters, apply_sort, count_of, facets_for

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

    row = session.get(BackgroundJob, parse_uuid(job_id, field="id"))
    if row is None:
        raise NotFoundError("That job does not exist.")
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


def cancel(session, job_id: str, *, principal) -> dict[str, Any]:
    """Stop this job, keeping the row.

    Not a delete: a queue whose cancelled jobs vanish cannot answer "why did
    the nightly export not run last Tuesday", which is the question it gets.
    """
    principal.require(VIEW_PERMISSION, MANAGE_PERMISSION)
    row = _job(session, job_id)

    if row.status not in vocabulary.JOB_CANCELLABLE:
        raise ConflictError(
            f"{row.reference} already finished as {row.status.lower()} — "
            "there is nothing left to stop.",
            details={"status": row.status, "cancellable_from": list(vocabulary.JOB_CANCELLABLE)},
        )

    before = {"status": row.status}
    moment = now()
    row.status = "CANCELLED"
    row.finished_at = moment
    if row.started_at is not None and row.duration_ms is None:
        row.duration_ms = int((moment - row.started_at).total_seconds() * 1000)
    row.log_lines = [
        *(row.log_lines or []),
        {
            "at": iso(moment),
            "level": "WARNING",
            "message": f"cancelled by {principal.full_name or principal.username}",
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
        after={"status": row.status},
        message=f"cancelled {row.reference}",
    )
    session.flush()
    return summarise(row)


def allow_attempts(session, job_id: str, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Grant this job more attempts.

    The action the retry refusal has always pointed at. Deliberately its own
    verb rather than a flag on `retry`: raising a limit and running the work
    are two decisions, and an operator who wanted one and got both would have
    no way to say so.

    Only ever upward, and only within `MAX_ALLOWED_ATTEMPTS`. Lowering it below
    the attempts already spent would make `attempt 4 of 3` a state the console
    would have to explain, and there is nothing an operator gains by it.
    """
    principal.require(VIEW_PERMISSION, MANAGE_PERMISSION)
    row = _job(session, job_id)

    try:
        wanted = int(payload.get("max_attempts"))
    except (TypeError, ValueError):
        raise ValidationError(
            "max_attempts must be a whole number.",
            details={"value": payload.get("max_attempts")},
        ) from None

    if wanted <= row.max_attempts:
        raise ValidationError(
            f"{row.reference} already allows {row.max_attempts} attempts. "
            "This grants more; it does not take any away.",
            details={"max_attempts": row.max_attempts, "requested": wanted},
        )
    if wanted > MAX_ALLOWED_ATTEMPTS:
        raise ValidationError(
            f"{MAX_ALLOWED_ATTEMPTS} attempts is the most one job may be granted.",
            details={"maximum": MAX_ALLOWED_ATTEMPTS, "requested": wanted},
        )

    before = {"max_attempts": row.max_attempts}
    row.max_attempts = wanted
    row.log_lines = [
        *(row.log_lines or []),
        {
            "at": iso(now()),
            "level": "INFO",
            "message": (
                f"limit raised to {wanted} attempts by "
                f"{principal.full_name or principal.username}"
            ),
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
        after={"max_attempts": row.max_attempts},
        message=f"raised {row.reference} to {wanted} attempts",
    )
    session.flush()
    return summarise(row)
