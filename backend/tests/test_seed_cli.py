"""`python -m src.seed` as an operator runs it (§back-end phase 2).

`test_seed` checks what the generator builds and that a seeded database
verifies. This drives the command line itself — every `--sync-*` repair, the
`--check` report, the refusal to seed twice — against the scratch database, so
none of it touches the demo dataset the running stack serves, and with object
storage swapped for a directory under `tmp_path` so no bytes reach the shared
bucket.

Each repair is run twice: the second pass is the idempotence claim every one of
them makes in its docstring ("safe to run on every seed"), and a repair that
finds work on its own output is a repair that never converges.
"""

from __future__ import annotations

import pytest

from tests.test_seed import scratch_database  # noqa: F401 - a fixture, used by name

SYNC_FLAGS = (
    "--sync-files",
    "--sync-exports",
    "--sync-imports",
    "--sync-favorites",
    "--sync-tags",
    "--sync-searches",
    "--sync-sessions",
    "--sync-roles",
    "--sync-settings",
    "--sync-mailboxes",
    "--sync-org",
    "--sync-flags",
    "--sync-activity",
    "--sync-preferences",
    "--sync-health",
    "--sync-jobs",
    "--sync-automations",
    "--sync-reports",
    # The feature repairs added with each workstream (§18, §41–49, §12–25).
    "--sync-analytics",
    "--sync-workflows",
    "--sync-developers",
    "--sync-planning",
    "--sync-approvals",
    "--sync-time",
    "--sync-sla",
    "--sync-forms",
    "--sync-dashboards",
    "--sync-insights",
    "--sync-knowledge",
    "--sync-assistant",
    "--sync-collab",
    "--sync-onboarding",
    "--sync-report-documents",
)


@pytest.fixture()
def local_storage(monkeypatch, tmp_path):
    from src.core import storage
    from src.core.storage import LocalStorage

    store = LocalStorage(str(tmp_path / "objects"), secret="test", prefix="/files")
    monkeypatch.setattr(storage, "for_config", lambda **_kwargs: store)
    return store


def test_a_dry_run_builds_without_a_database(capsys):
    from src.seed.__main__ import main

    assert main(["--dry-run", "--scale", "small", "--seed", "3"]) == 0
    out = capsys.readouterr().out
    assert "nothing written" in out
    assert main(["--dry-run", "--scale", "small", "--seed", "3", "--quiet"]) == 0


@pytest.mark.database
def test_the_command_line_seeds_checks_and_repairs(
    scratch_database, local_storage, capsys  # noqa: F811 - the imported fixture
):
    from src.seed.__main__ import main

    assert main(["--reset", "--scale", "small", "--seed", "11"]) == 0
    seeded = capsys.readouterr().out
    assert "consistent" in seeded

    # A populated database is never seeded over by accident.
    assert main(["--scale", "small"]) == 0
    assert "already contains data" in capsys.readouterr().out

    assert main(["--check"]) == 0
    assert "dataset is consistent" in capsys.readouterr().out

    assert main(["--sync-schema"]) in (0, 1)
    capsys.readouterr()

    for flag in SYNC_FLAGS:
        assert main([flag]) == 0, flag
        assert main([flag, "--quiet"]) == 0, f"{flag} a second time"
    capsys.readouterr()

    # The repairs leave the dataset as consistent as they found it.
    assert main(["--check"]) == 0, capsys.readouterr().out


def test_a_month_of_history_that_ended_long_ago_is_stale():
    """Regression: `--sync-health` judged a history by its length alone.

    A database seeded in September and opened in November has two hundred
    readings and every window on `/admin/health` empty, and the repair called
    that "already has a month of history".
    """
    from datetime import timedelta

    from src.core.clock import iso, now
    from src.seed.runner import _history_is_stale

    anchor = now()
    fresh = [{"at": iso(anchor - timedelta(hours=hour))} for hour in range(240)]
    old = [{"at": iso(anchor - timedelta(days=60, hours=hour))} for hour in range(240)]
    assert _history_is_stale(fresh, anchor) is False
    assert _history_is_stale(old, anchor) is True
    assert _history_is_stale([], anchor) is True
    assert _history_is_stale([{"at": "garbage"}, "not-a-point"], anchor) is True


@pytest.mark.database
def test_sync_health_rewrites_a_history_that_ended_long_ago(
    scratch_database, local_storage  # noqa: F811 - the imported fixture
):
    from datetime import timedelta

    from sqlalchemy import select

    from src.core.clock import iso, now
    from src.core.db import session_scope
    from src.models.platform import ServiceHealth
    from src.seed import runner
    from src.seed.__main__ import main

    assert main(["--reset", "--scale", "small", "--seed", "5", "--quiet"]) == 0
    long_ago = now() - timedelta(days=60)
    with session_scope() as session:
        row = session.scalars(select(ServiceHealth)).first()
        row.history = [
            {"at": iso(long_ago - timedelta(hours=hour)), "status": "HEALTHY", "latency_ms": 1.0}
            for hour in range(240)
        ]
    with session_scope() as session:
        assert runner.sync_health(session)["extended"] >= 1
    with session_scope() as session:
        row = session.scalars(select(ServiceHealth).where(ServiceHealth.id == row.id)).one()
        assert not runner._history_is_stale(row.history, now())
