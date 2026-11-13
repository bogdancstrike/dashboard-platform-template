"""Cancelling a job, and allowing more attempts."""

from __future__ import annotations

from typing import Any

from src.core import audit, vocabulary
from src.core.clock import iso, now
from src.core.errors import ConflictError, ValidationError
from src.services.platform.jobs.listing_view import _job
from src.services.platform.jobs.policy import (
    MANAGE_PERMISSION,
    MAX_ALLOWED_ATTEMPTS,
    VIEW_PERMISSION,
    summarise,
)


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
