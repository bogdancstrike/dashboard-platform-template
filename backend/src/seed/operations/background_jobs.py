"""Seed data for operations: background_job."""

from __future__ import annotations

from datetime import timedelta

from src.seed import catalog
from src.seed.support import reference


def background_job(rng, *, index: int, status: str, users, scheduled_tasks, fresh: bool = False):
    """One job, built but not stored.

    Shared by the seed and by `--sync-jobs`, which tops up an existing
    database: two copies of "what a job looks like" is how a repair ends up
    writing rows the page renders differently from the seeded ones.

    `status` is passed in rather than drawn here, because the caller is the one
    that knows whether it is filling a distribution or covering a gap.

    `fresh` caps the attempt below `max_attempts`, so the job can still be
    retried. The draw gives attempt 3 about seven times in a hundred, and a
    job born at 3 of 3 is *spent* — which is fine in a distribution and useless
    in a repair whose whole purpose is to provide something actionable. A
    repair that fixed the problem ninety-three per cent of the time is one
    somebody runs twice and still does not trust.

    `fresh` also keeps the *kind* to one the queue console will retry. An
    EXPORT is re-requested rather than retried (`services/jobs.NOT_OURS_TO_RETRY`),
    so a top-up that drew one produced a row that satisfied the repair's count
    and none of its purpose — which is exactly what happened: `--sync-jobs`
    reported "2 added" and the end-to-end suite went on failing for want of a
    retryable cancelled job.
    """
    from src.models.platform import BackgroundJob
    from src.services.platform.jobs import NOT_OURS_TO_RETRY

    kinds = (
        tuple((kind, weight) for kind, weight in catalog.JOB_KINDS
               if kind not in NOT_OURS_TO_RETRY)
        if fresh
        else catalog.JOB_KINDS
    )
    kind = rng.weighted(kinds)
    initiator = rng.pick(users) if users else None
    scheduled = rng.pick(scheduled_tasks) if scheduled_tasks and rng.chance(0.3) else None

    total = rng.integer(10, 250_000)
    if status == "SUCCEEDED":
        processed, failed, progress = total, 0, 100
    elif status in ("FAILED", "RETRYING"):
        # RETRYING is a job that *has already failed* and will be tried again,
        # so it carries the failure that caused the retry. Without that the
        # page can say a job is retrying and never say why — and "failed and
        # will be tried again" versus "failed and will not" is the single
        # distinction an operator reads this screen for.
        processed = rng.integer(0, total)
        failed = rng.integer(1, max(1, total - processed) or 1)
        progress = int(processed / total * 100)
    elif status == "QUEUED":
        processed, failed, progress = 0, 0, 0
    else:
        processed = rng.integer(1, total)
        failed, progress = 0, int(processed / total * 100)

    started = rng.recent(days=20) if status != "QUEUED" else None
    duration = rng.integer(200, 5_400_000) if status in ("SUCCEEDED", "FAILED", "CANCELLED") else None
    finished = started + timedelta(milliseconds=duration) if started and duration else None
    # A retry is not the first attempt, by definition — and it has not used up
    # `max_attempts`, or it would be FAILED for good.
    if status == "RETRYING":
        attempt = 2
    elif fresh:
        attempt = rng.weighted(((1, 0.85), (2, 0.15)))
    else:
        attempt = rng.weighted(((1, 0.8), (2, 0.13), (3, 0.07)))
    failure = rng.pick(catalog.JOB_ERRORS) if status in ("FAILED", "RETRYING") else None

    return BackgroundJob(
        id=rng.uuid(),
        # An export carries the prefix `/exports` shows, because that is the
        # string somebody quotes back ("EXP-000012 downloaded empty") — and
        # because an export a person requests has to be indistinguishable from
        # a seeded one or the demo splits into "the real ones and mine".
        # Sparse within its own prefix, which `core/naming` is fine with: the
        # next one is `MAX(reference) + 1`, not a count.
        reference=reference("EXP" if kind == "EXPORT" else "JOB", index + 1, width=6),
        name=f"{kind.title()} — {rng.pick(('projects', 'orders', 'tickets', 'customers', 'tasks', 'audit log'))}",
        kind=kind,
        queue=rng.weighted((("default", 0.6), ("exports", 0.2), ("imports", 0.12), ("maintenance", 0.08))),
        status=status,
        priority=rng.weighted(catalog.PRIORITIES),
        progress=progress,
        total_units=total,
        processed_units=processed,
        failed_units=failed,
        attempt=attempt,
        max_attempts=3,
        started_at=started,
        finished_at=finished,
        duration_ms=duration,
        scheduled_for=rng.ahead(days_min=0, days_max=2) if status == "QUEUED" else None,
        initiated_by_id=initiator.id if initiator else None,
        initiated_by_label=initiator.full_name if initiator else "System",
        organization_id=initiator.organization_id if initiator else None,
        scheduled_task_id=scheduled.id if scheduled else None,
        error_message=failure,
        # A resource key and a format, which for an EXPORT is a real
        # `explorer.Plan` — `seed/exports.py` fills in the rest and produces
        # the file. The old payload named an "entity" nothing could resolve and
        # claimed an artefact nobody had written, so every download 404'd.
        payload={
            "resource_type": rng.pick(("project", "order", "ticket", "customer")),
            "format": rng.pick(("csv", "xlsx", "json")),
        },
        # Deliberately empty. What a finished export produced is written by
        # whatever produced it, and a seeded `{"rows": …, "artifact": …}` was a
        # claim about bytes that did not exist.
        result=None,
        # Inline log lines so the job drawer needs no join.
        log_lines=[
            {
                "at": (started + timedelta(seconds=offset)).isoformat() if started else None,
                "level": level,
                "message": message,
            }
            for offset, level, message in (
                (0, "INFO", "job accepted"),
                (2, "INFO", f"processing {total} units"),
                (5, "WARNING", "slow batch, continuing") if rng.chance(0.3) else (5, "INFO", "halfway"),
                (9, "ERROR", failure) if failure else (9, "INFO", "finished"),
            )
        ] if started else None,
        created_at=started or rng.recent(days=3),
    )
