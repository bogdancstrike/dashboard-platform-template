"""The recurrence job: ensure, run, catch up."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.services.work.sprints import MANAGE
from src.services.work.task_templates.occurrences import run_recurrences
from src.services.work.task_templates.template_store import JOBS


def ensure_jobs(session) -> dict[str, Any]:
    """The two scheduled tasks, created on first use (and by the seed)."""
    from src.models.platform import ScheduledTask

    rows = {}
    for code, (name, cron, kind, _period) in JOBS.items():
        row = session.scalars(select(ScheduledTask).where(ScheduledTask.code == code)).first()
        if row is None:
            row = ScheduledTask(
                name=name, code=code, cron=cron, timezone="UTC", job_kind=kind, enabled=True,
                description=f"{name} — work planning (§18). Runs on `{cron}`.",
                next_run_at=now(), run_count=0, failure_count=0,
            )
            session.add(row)
            session.flush()
        rows[code] = row
    return rows


def run_scheduler(session, *, principal=None, codes: tuple[str, ...] | None = None) -> dict[str, Any]:
    """Run the planning jobs now, each recorded as a background job."""
    from src.models.platform import BackgroundJob
    from src.services.work import sprints

    started = now()
    jobs = ensure_jobs(session)
    results: dict[str, Any] = {}
    from src.core import features

    for code, scheduled in jobs.items():
        if codes and code not in codes:
            continue
        if not features.job_allowed(code):
            # Switched off (§27): the job is skipped, not failed, and runs
            # again on its next tick once the flag is back on.
            continue
        name, _cron, kind, period = JOBS[code]
        clock = now()
        if code == "work.recurring-tasks":
            outcome = run_recurrences(session, clock)
            lines = [f"{outcome['rules']} rule(s) due, {len(outcome['created'])} task(s) created"]
            lines += [f"created {reference}" for reference in outcome["created"][:50]]
            units = len(outcome["created"])
        else:
            count = sprints.snapshot_active(session, clock.date())
            outcome = {"sprints": count}
            lines = [f"snapshot written for {count} running sprint(s)"]
            units = count
        finished = now()
        session.add(
            BackgroundJob(
                reference=f"JOB-W{finished.strftime('%y%m%d%H%M%S%f')[:16]}{len(results)}",
                name=name, kind=kind, queue="planning", status="SUCCEEDED", priority="NORMAL",
                progress=100, total_units=units, processed_units=units, failed_units=0,
                attempt=1, max_attempts=1, started_at=clock, finished_at=finished,
                duration_ms=int((finished - clock).total_seconds() * 1000),
                scheduled_for=scheduled.next_run_at or clock,
                initiated_by_id=principal.user_id if principal else None,
                initiated_by_label=(principal.full_name if principal else "Scheduler"),
                scheduled_task_id=scheduled.id, payload={"code": code}, result=outcome,
                log_lines=[{"at": finished.isoformat(), "level": "INFO", "message": line} for line in lines],
            )
        )
        scheduled.last_run_at = clock
        scheduled.last_status = "SUCCEEDED"
        scheduled.last_duration_ms = int((finished - clock).total_seconds() * 1000)
        scheduled.run_count = (scheduled.run_count or 0) + 1
        scheduled.next_run_at = clock + period
        results[code] = outcome
    session.flush()
    return {"ran_at": started.isoformat(), "results": results}


def run_now(session, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    return run_scheduler(session, principal=principal)


def catch_up(session) -> bool:
    """Start the jobs off this request if one is overdue. Returns whether it did."""
    from src.config import Config
    from src.core import background
    from src.models.platform import ScheduledTask

    # A test asserts on what it ran; work started behind its back is a race.
    if Config.ENVIRONMENT == "test":
        return False
    ensure_jobs(session)
    overdue = session.scalars(
        select(ScheduledTask.code).where(
            ScheduledTask.code.in_(tuple(JOBS)),
            ScheduledTask.enabled.is_(True),
            ScheduledTask.next_run_at <= now(),
        )
    ).all()
    if not overdue:
        return False
    codes = tuple(overdue)

    def work() -> None:
        from src.core.db import session_scope

        with session_scope() as own:
            run_scheduler(own, codes=codes)

    background.spawn(work, name="work-planning-scheduler")
    return True
