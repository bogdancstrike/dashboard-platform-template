"""Topping up the job fixtures the end-to-end suite spends."""

from __future__ import annotations


def sync_jobs(session) -> dict[str, int]:
    """Top every job status up to `GUARANTEED_PER_STATUS`, additively.

    The fifth of these repairs, and the one to run when the end-to-end suite
    starts complaining that nothing is queued. `JOB_STATUS` is what
    `/admin/jobs` builds its filters from, and RETRYING is weighted at 0.04 —
    so at the small scale the draw leaves it empty about half the time and the
    console offers a filter that can never match anything (§76). The suite then
    *spends* these: it retries a job and cancels another, and a retry spends an
    attempt irreversibly, so the states drain with use.

    One invariant: `GUARANTEED_PER_STATUS` jobs per status that the console can
    actually *retry*. Stated that way because it subsumes the row count — a
    retryable job is a row — and because the two things it guarantees are what
    the console and the suite each need: no filter that can never match, and
    something left to retry. Counting rows alone kept finding five cancelled
    jobs and never noticing every one had spent its attempts; then counting
    `attempt < max_attempts` alone counted three *exports*, which this console
    does not retry at all (§30). Both times the repair reported success and
    changed nothing, which is the failure mode to watch for here: the count has
    to be of the same thing the guard checks.

    Additive by construction: it counts what is there and inserts only what is
    short. Never edits an existing job, because a job's status and its attempt
    count are a *record of what happened*, and rewriting either would be the
    repair telling a lie about history.
    """
    from sqlalchemy import func
    from sqlalchemy import select as _select

    from src.core import vocabulary
    from src.core.clock import now
    from src.core.naming import sequence_of
    from src.models.identity import User
    from src.models.platform import BackgroundJob, ScheduledTask
    from src.seed.operations import background_job
    from src.seed.support import Rng
    from src.services.platform.jobs import NOT_OURS_TO_RETRY

    anchor = now()
    # Seeded from the clock for the same reason `sync_mailboxes` is: a fixed
    # seed regenerates the same UUIDs, so a second run collides with the rows
    # the first one wrote.
    rng = Rng(int(anchor.timestamp() * 1000), anchor).derive("jobs-topup")

    from src.seed.operations import GUARANTEED_PER_STATUS

    # Counted two ways, because the console needs two different things and the
    # first version of this only guaranteed the first.
    #
    # *Rows* per status is what the filters need: a status with none is a
    # filter that can never match anything (§76).
    #
    # *Retryable* rows — `attempt < max_attempts` — is what the suite needs,
    # and it is the one that ran dry. A retry spends an attempt irreversibly,
    # so topping up by row count alone kept finding five cancelled jobs and
    # never noticed that none of them could be retried any more. The end-to-end
    # spec then failed on its own guard, which is at least the right failure.
    counted = dict(
        session.execute(
            _select(BackgroundJob.status, func.count()).group_by(BackgroundJob.status)
        ).all()
    )
    fresh = dict(
        session.execute(
            _select(BackgroundJob.status, func.count())
            .where(
                BackgroundJob.attempt < BackgroundJob.max_attempts,
                # The console's own rule, not a looser one. `can_retry` also
                # refuses a kind another screen owns — an export is
                # re-requested on `/exports`, not retried here (§30) — and
                # counting those as "fresh" is how the repair came to report
                # "0 added — every status already has the guaranteed minimum"
                # while three of the queue's four retryable-looking cancelled
                # jobs were exports the console would not touch. A repair that
                # measures a different thing from the guard it exists to
                # satisfy is a repair that reports success and changes nothing.
                BackgroundJob.kind.notin_(tuple(NOT_OURS_TO_RETRY)),
            )
            .group_by(BackgroundJob.status)
        ).all()
    )
    # One invariant, stated once: `GUARANTEED_PER_STATUS` jobs per status that
    # are still *within their attempts*. It subsumes the row count, since a
    # fresh job is a row — and guaranteeing only one actionable job made the
    # suite green for exactly one run per repair, because each run spends it.
    wanted = [
        (
            status,
            max(
                GUARANTEED_PER_STATUS - int(counted.get(status, 0)),
                GUARANTEED_PER_STATUS - int(fresh.get(status, 0)),
            ),
        )
        for status in vocabulary.JOB_STATUS
    ]
    missing = [(status, short) for status, short in wanted if short > 0]
    if not missing:
        return {"added": 0, "statuses": 0}

    users = session.scalars(_select(User).where(User.deleted_at.is_(None)).limit(50)).all()
    tasks = session.scalars(_select(ScheduledTask).limit(20)).all()
    # Numbered past the highest existing reference — the *reference*, not the
    # row count, which is what this used to read. `reference` is unique in the
    # schema, and a count is only coincidentally related to the highest number
    # in it: exports carry their own `EXP-` prefix (§30) and their records can
    # be removed, so the count can *fall* while `JOB-001034` still exists.
    # `MAX(reference)` per prefix is what `core/naming` prescribes and what
    # every other reference generator in the platform does.
    #
    # Both prefixes, because `background_job` draws its kind and an EXPORT one
    # is numbered `EXP-` from the same index.
    highest = max(
        sequence_of(
            session.scalar(
                _select(func.max(BackgroundJob.reference)).where(
                    BackgroundJob.reference.like(f"{prefix}-%")
                )
            ),
            prefix=prefix,
        )
        for prefix in ("JOB", "EXP")
    )

    offset = 0
    for status, short in missing:
        for _ in range(short):
            session.add(
                background_job(
                    rng,
                    index=highest + offset + 1000,
                    status=status,
                    users=list(users),
                    scheduled_tasks=list(tasks),
                    # Below `max_attempts`, so what this adds is something the
                    # console can actually act on.
                    fresh=True,
                )
            )
            offset += 1

    return {"added": offset, "statuses": len(missing)}
