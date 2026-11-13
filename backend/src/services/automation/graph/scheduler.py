"""The scheduler's pass: due schedules and finished delays, caught up lazily."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.models.automation_graphs import AutomationGraph, AutomationWait
from src.models.platform import AlertRule
from src.services.automation.graph.cron import _cron, cron_due
from src.services.automation.graph.runs import evaluate
from src.services.automation.graph.shape import PERMISSION, trigger_of
from src.services.automation.graph.waits import resume


def run_due(session, *, principal=None) -> dict[str, int]:
    """The scheduler's pass: scheduled workflows that are due, and delays that are over."""
    from src.core import features

    if not features.job_allowed("automation.scheduler"):
        return {"scheduled": 0, "resumed": 0}
    moment = now()
    ran = resumed = 0
    rows = session.execute(
        select(AlertRule, AutomationGraph)
        .join(AutomationGraph, AutomationGraph.rule_id == AlertRule.id)
        .where(AlertRule.enabled.is_(True), AlertRule.deleted_at.is_(None))
    ).unique().all()
    for rule, graph_row in rows:
        trigger = trigger_of(graph_row.published)
        if trigger is None or trigger["data"].get("event") != "SCHEDULE":
            continue
        expression = str(trigger["data"].get("schedule") or "")
        try:
            due = cron_due(_cron(expression), graph_row.last_scheduled_at or graph_row.published_at, moment)
        except ValidationError:
            continue
        graph_row.last_scheduled_at = moment
        if due:
            evaluate(session, rule, principal=None, dry_run=False, graph_row=graph_row,
                     event={"event": "SCHEDULE", "schedule": expression})
            ran += 1
    waits = session.scalars(
        select(AutomationWait).where(AutomationWait.status == "PENDING", AutomationWait.kind == "DELAY",
                                     AutomationWait.due_at <= moment).limit(200)
    ).all()
    for wait in waits:
        resume(session, wait, "out")
        resumed += 1
    session.flush()
    return {"scheduled": ran, "resumed": resumed}


def run_scheduler(session, *, principal) -> dict[str, Any]:
    principal.require(PERMISSION)
    result = run_due(session, principal=principal)
    return {**result, "ran_at": iso(now())}


_LAST_CATCH_UP: list[float] = [0.0]


CATCH_UP_SECONDS = 60


def catch_up() -> bool:
    """Run the scheduler off a request, at most once a minute per process.

    There is no worker process (see `core/background`), so — like the work
    planning scheduler — the first automations request after a minute starts a
    pass in the background. Never in tests: work started behind a test's back
    is a race.
    """
    import time

    from src.config import Config
    from src.core import background

    if Config.ENVIRONMENT == "test":
        return False
    if time.monotonic() - _LAST_CATCH_UP[0] < CATCH_UP_SECONDS:
        return False
    _LAST_CATCH_UP[0] = time.monotonic()

    def work() -> None:
        from src.core.db import session_scope

        with session_scope() as own:
            run_due(own)

    background.spawn(work, name="automation-scheduler")
    return True
