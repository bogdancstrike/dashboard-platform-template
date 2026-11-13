"""The two scheduled jobs of Records & analytics (§12, §22, §23).

* `analytics.customer-health` — daily: recompute every customer's score and
  write today's snapshot; a band drop notifies the account manager.
* `analytics.anomaly-watch` — hourly: evaluate every enabled metric watch.

Both live in the platform's own jobs system (`scheduled_tasks` + one
`background_jobs` row per run, visible at /admin/jobs), exactly like the work
planning jobs. There is no worker process (`core/background`), so a run is
started by "Run now" or, lazily, by the first request to these features after
a job's `next_run_at` — spawned off that request.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import select

from src.core.clock import now

JOBS: dict[str, tuple[str, str, str, timedelta]] = {
    "analytics.customer-health": ("Customer health scores", "15 2 * * *", "HEALTH", timedelta(hours=24)),
    "analytics.anomaly-watch": ("Metric anomaly watch", "0 * * * *", "ANOMALY", timedelta(hours=1)),
}


def ensure_jobs(session) -> dict[str, Any]:
    from src.models.platform import ScheduledTask

    rows = {}
    for code, (name, cron, kind, _period) in JOBS.items():
        row = session.scalars(select(ScheduledTask).where(ScheduledTask.code == code)).first()
        if row is None:
            row = ScheduledTask(
                name=name, code=code, cron=cron, timezone="UTC", job_kind=kind, enabled=True,
                description=f"{name} — records & analytics. Runs on `{cron}`.",
                next_run_at=now(), run_count=0, failure_count=0,
            )
            session.add(row)
            session.flush()
        rows[code] = row
    return rows


def run(session, code: str, *, principal=None) -> dict[str, Any]:
    """Run one job now and record it."""
    from src.models.platform import BackgroundJob
    from src.services import customer_health, metric_watches

    scheduled = ensure_jobs(session)[code]
    name, _cron, kind, period = JOBS[code]
    started = now()
    error = None
    try:
        nested = session.begin_nested()
        if code == "analytics.customer-health":
            outcome = customer_health.recompute(session, notify=True)
            lines = [f"{outcome['customers']} customer(s) scored, {outcome['dropped']} dropped a band, "
                     f"{outcome['improved']} improved"]
            units = outcome["customers"]
        else:
            outcome = metric_watches.evaluate_all(session)
            lines = [f"{outcome['watches']} watch(es) evaluated, {outcome['anomalies']} new anomal(ies)"]
            units = outcome["watches"]
        nested.commit()
    except Exception as exc:  # recorded on the job, never raised into a request
        nested.rollback()
        error = str(exc)[:500]
        outcome, lines, units = {"error": error}, [f"failed: {error}"], 0
    finished = now()
    status = "FAILED" if error else "SUCCEEDED"
    session.add(BackgroundJob(
        reference=f"JOB-A{finished.strftime('%y%m%d%H%M%S%f')[:16]}{kind[0]}",
        name=name, kind=kind, queue="analytics", status=status, priority="NORMAL",
        progress=100, total_units=units, processed_units=units, failed_units=1 if error else 0,
        attempt=1, max_attempts=1, started_at=started, finished_at=finished,
        duration_ms=int((finished - started).total_seconds() * 1000),
        scheduled_for=scheduled.next_run_at or started,
        initiated_by_id=principal.user_id if principal else None,
        initiated_by_label=(principal.full_name if principal else "Scheduler"),
        scheduled_task_id=scheduled.id, payload={"code": code}, result=outcome,
        error_message=error,
        log_lines=[{"at": finished.isoformat(), "level": "ERROR" if error else "INFO", "message": line}
                   for line in lines],
    ))
    scheduled.last_run_at = started
    scheduled.last_status = status
    scheduled.last_duration_ms = int((finished - started).total_seconds() * 1000)
    scheduled.run_count = (scheduled.run_count or 0) + 1
    if error:
        scheduled.failure_count = (scheduled.failure_count or 0) + 1
    scheduled.next_run_at = started + period
    session.flush()
    return {"code": code, "status": status, **outcome}


def catch_up(session) -> bool:
    """Start any overdue job off this request. Returns whether one was started."""
    from src.config import Config
    from src.core import background
    from src.models.platform import ScheduledTask

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
    # Moved on before the work starts, so a burst of requests starts it once.
    for row in session.scalars(select(ScheduledTask).where(ScheduledTask.code.in_(codes))):
        row.next_run_at = now() + timedelta(minutes=10)
    session.flush()

    def work() -> None:
        from src.core.db import session_scope

        for code in codes:
            with session_scope() as own:
                run(own, code)

    background.spawn(work, name="analytics-jobs")
    return True
