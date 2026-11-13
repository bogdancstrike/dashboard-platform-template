"""The work-planning scheduler: catching up off a request, skipping what is off, recurrences.

`test_work_planning` drives one recurrence through `/api/work/scheduler/run`.
These pin the scheduler's own decisions: an overdue job is started in the
background from an ordinary request (never in the test environment, where it
would race the test), a job whose feature is switched off is skipped rather
than failed, and the recurrence runner's three edge cases — a source task that
has gone, a rule far overdue (catches up at most `MAX_CATCH_UP`), and a rule
past its `until`.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from src.config import Config
from src.services.work import task_templates as service
from tests.patching import patch_package
from tests.personas import PREFIX, sign_in

pytestmark = pytest.mark.database


def test_an_overdue_job_is_started_off_the_request_except_under_test(monkeypatch):
    from src.core import background
    from src.core.db import session_scope

    with session_scope() as session:
        assert service.catch_up(session) is False  # ENVIRONMENT == "test": never behind a test's back

    monkeypatch.setattr(Config, "ENVIRONMENT", "production")
    started: list = []
    monkeypatch.setattr(background, "spawn", lambda work, *, name: started.append((name, work)) or "thread")
    with session_scope() as session:
        jobs = service.ensure_jobs(session)
        for row in jobs.values():
            row.next_run_at = datetime.now(UTC) - timedelta(minutes=5)
        session.flush()
        assert service.catch_up(session) is True
    assert [name for name, _work in started] == ["work-planning-scheduler"]

    started[0][1]()  # what the background thread would run
    with session_scope() as session:
        rows = service.ensure_jobs(session)
        assert all(row.next_run_at > datetime.now(UTC) for row in rows.values())
        assert all(row.last_status == "SUCCEEDED" for row in rows.values())
        assert service.catch_up(session) is False  # nothing overdue any more


def test_a_job_whose_feature_is_off_is_skipped_not_failed(monkeypatch):
    from src.core import features
    from src.core.db import session_scope

    patch_package(monkeypatch, features, "job_allowed", lambda code: False)
    with session_scope() as session:
        assert service.run_scheduler(session)["results"] == {}


def _task(client, headers, title):
    made = client.post(f"{PREFIX}/api/records/task", json={"title": title}, headers=headers)
    assert made.status_code == 201, made.get_json()
    return made.get_json()["id"]


def test_the_recurrence_runner_handles_gone_far_overdue_and_finished_rules(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.business import Task
    from src.models.planning import TaskRecurrence

    headers = sign_in(monkeypatch, "admin")
    gone, overdue, finished = (_task(client, headers, f"Recurrence probe {n}") for n in range(3))
    for task_id in (gone, overdue, finished):
        url = f"{PREFIX}/api/tasks/{task_id}/recurrence"
        assert client.put(url, json={"frequency": "DAILY"}, headers=headers).status_code == 200

    moment = datetime.now(UTC)
    with session_scope() as session:
        rules = {str(r.task_id): r for r in session.scalars(
            select(TaskRecurrence).where(TaskRecurrence.task_id.in_([gone, overdue, finished])))}
        rules[gone].next_run_at = moment - timedelta(days=1)
        session.get(Task, rules[gone].task_id).deleted_at = moment
        rules[overdue].next_run_at = moment - timedelta(days=10)
        rules[finished].next_run_at = moment - timedelta(hours=1)
        rules[finished].until = date.today()

    with session_scope() as session:
        outcome = service.run_recurrences(session, moment)

    with session_scope() as session:
        rules = {str(r.task_id): r for r in session.scalars(
            select(TaskRecurrence).where(TaskRecurrence.task_id.in_([gone, overdue, finished])))}
        assert rules[gone].active is False and rules[gone].next_run_at is None
        assert rules[overdue].occurrences == service.MAX_CATCH_UP  # ten days owed, three made
        assert rules[overdue].next_run_at > moment
        assert rules[finished].active is False and rules[finished].occurrences == 1
    assert len(outcome["created"]) >= service.MAX_CATCH_UP + 1
