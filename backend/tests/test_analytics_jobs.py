"""The scheduled jobs of Records & analytics (§23): recorded runs, failures kept."""

from __future__ import annotations

import pytest

from src.services.analytics import jobs as jobs

pytestmark = pytest.mark.database


def test_both_jobs_exist_and_a_run_is_recorded():
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.platform import BackgroundJob

    with session_scope() as session:
        rows = jobs.ensure_jobs(session)
        assert set(rows) == set(jobs.JOBS)
        result = jobs.run(session, "analytics.anomaly-watch")
        assert result["status"] == "SUCCEEDED"
        job = session.scalars(select(BackgroundJob).where(BackgroundJob.queue == "analytics")
                              .order_by(BackgroundJob.created_at.desc())).first()
        assert job.kind == "ANOMALY"
        assert rows["analytics.anomaly-watch"].next_run_at > rows["analytics.anomaly-watch"].last_run_at


def test_a_failing_run_is_recorded_not_raised(monkeypatch):
    from src.core.db import session_scope
    from src.services.records import customer_health

    def boom(*_a, **_k):
        raise RuntimeError("model exploded")

    monkeypatch.setattr(customer_health, "recompute", boom)
    with session_scope() as session:
        result = jobs.run(session, "analytics.customer-health")
        assert result["status"] == "FAILED"
        assert "model exploded" in result["error"]


def test_catch_up_never_runs_under_test():
    from src.core.db import session_scope

    with session_scope() as session:
        assert jobs.catch_up(session) is False


def test_catch_up_starts_overdue_jobs_off_the_request(monkeypatch):
    from datetime import timedelta

    from src.config import Config
    from src.core import background
    from src.core.clock import now
    from src.core.db import session_scope

    monkeypatch.setattr(Config, "ENVIRONMENT", "local")
    ran: list[str] = []
    monkeypatch.setattr(jobs, "run", lambda _s, code, **_k: ran.append(code))
    with session_scope() as session:
        rows = jobs.ensure_jobs(session)
        saved = {code: row.next_run_at for code, row in rows.items()}
        rows["analytics.anomaly-watch"].next_run_at = now() - timedelta(minutes=1)
        rows["analytics.customer-health"].next_run_at = now() + timedelta(hours=1)
    try:
        with background.synchronous():
            with session_scope() as session:
                assert jobs.catch_up(session) is True
        assert ran == ["analytics.anomaly-watch"]
        with session_scope() as session:
            assert jobs.catch_up(session) is False
    finally:
        with session_scope() as session:
            for code, row in jobs.ensure_jobs(session).items():
                row.next_run_at = saved[code]
