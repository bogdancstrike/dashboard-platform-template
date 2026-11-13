"""The system log: the sink that writes it and the viewer that reads it (§22). — the catalogue."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from src.core import logsink, vocabulary
from src.core.clock import now
from src.core.db import session_scope
from src.services.platform import system_logs as service
from tests.logs_support import (  # noqa: F401
    LOGS,
    _authenticate,
    _line,
    pytestmark,
)


def test_the_catalogue_offers_every_level_even_the_empty_ones(client, monkeypatch):
    """A level chip that appears only once something is broken is a chip
    somebody learns to stop looking for."""
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{LOGS}/catalogue", headers=headers).get_json()
    assert [item["key"] for item in answer["levels"]] == list(vocabulary.LOG_LEVEL)


def test_the_catalogue_reports_the_retention_the_setting_declares(client, monkeypatch):
    """Read from the settings table, not declared here: a viewer that said
    "kept for 30 days" while the setting said 90 would be lying about its own
    data."""
    from src.models.platform import SystemSetting

    headers = _authenticate(monkeypatch)
    with session_scope() as session:
        row = session.scalar(
            select(SystemSetting).where(SystemSetting.key == "retention.log_days")
        )
        declared = (row.value or {}).get("value") if row else None
    answer = client.get(f"{LOGS}/catalogue", headers=headers).get_json()

    assert answer["retention_days"] == declared


def test_the_filter_vocabulary_is_the_one_the_sql_is_built_from(client, monkeypatch):
    """A filter the UI offers is by construction a filter the backend honours —
    which is the reason this list is built on `core/query` at all."""
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{LOGS}/catalogue", headers=headers).get_json()
    names = {field["name"] for field in answer["fields"]}
    assert {"level", "service", "logger", "correlation_id", "status_code"} <= names


def test_pruning_removes_what_is_older_than_the_bound_and_keeps_the_rest():
    keep, _ = _line(message="recent enough", logged_at=now() - timedelta(days=1))
    with session_scope() as session:
        days = service._retention(session) or 30
    drop, _ = _line(message="long past", logged_at=now() - timedelta(days=days + 5))

    with session_scope() as session:
        removed = logsink.sweep(session, days=days)
    assert removed >= 1

    from src.models.platform import SystemLog

    with session_scope() as session:
        assert session.get(SystemLog, uuid.UUID(drop)) is None
        assert session.get(SystemLog, uuid.UUID(keep)) is not None


def test_pruning_takes_its_bound_from_the_setting_and_not_the_request(client, monkeypatch):
    """A `days` parameter would make this an arbitrary delete endpoint wearing
    a retention policy's name."""
    headers = _authenticate(monkeypatch)
    from src.models.platform import SystemLog

    old, _ = _line(message="ancient", logged_at=now() - timedelta(days=4000))

    answer = client.post(f"{LOGS}/prune?days=1", headers=headers).get_json()

    with session_scope() as session:
        assert session.get(SystemLog, uuid.UUID(old)) is None
    # The declared bound, not the one in the query string.
    assert answer["retention_days"] != 1
    assert answer["removed"] >= 1


def test_a_retention_of_zero_is_refused_rather_than_deleting_everything():
    """`days=0` through the arithmetic is "older than now", which is the whole
    table. A bound that means "delete everything" has to be said out loud."""
    with session_scope() as session:
        with pytest.raises(ValueError):
            logsink.sweep(session, days=0)
        with pytest.raises(ValueError):
            logsink.sweep(session, days=-7)


def test_reading_the_log_needs_logs_view(client, monkeypatch):
    headers = _authenticate(monkeypatch, "user", "viewer")
    assert client.get(LOGS, headers=headers).status_code == 403
    assert client.get(f"{LOGS}/catalogue", headers=headers).status_code == 403
    assert client.get(f"{LOGS}/tail", headers=headers).status_code == 403


def test_an_administrator_may_read_it(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{LOGS}?page_size=5", headers=headers)
    assert answer.status_code == 200
    body = answer.get_json()
    assert "items" in body and "facets" in body


def test_pruning_needs_the_permission_that_owns_the_bound(client, monkeypatch):
    """A manager holds `logs.view` and not `settings.manage`: they may read the
    log and may not enact the policy on it early."""
    headers = _authenticate(monkeypatch, "manager", "manager")
    assert client.get(LOGS, headers=headers).status_code == 200
    assert client.post(f"{LOGS}/prune", headers=headers).status_code == 403
