"""Shared helpers and fixtures for the bulk tests."""

from __future__ import annotations

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


TASKS = f"{PREFIX}/api/records/task"


BULK = f"{TASKS}/bulk"


PREVIEW = f"{BULK}/preview"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"bulk-{username}"),
    )
    return {"Authorization": f"Bearer bulk-{username}"}


def _erase(ids: list[str]) -> None:
    """Out of the dataset for good.

    A hard delete rather than the API's soft one: a soft-deleted row still
    occupies its `reference`, and a suite that runs fifty times otherwise
    leaves fifty invisible tasks behind.
    """
    from src.core.db import session_scope
    from src.models.business import Task
    from src.models.platform import ActivityEntry, AuditLog

    with session_scope() as session:
        for record_id in ids:
            session.query(ActivityEntry).filter(
                ActivityEntry.resource_type == "task",
                ActivityEntry.resource_id == str(record_id),
            ).delete(synchronize_session=False)
            session.query(AuditLog).filter(
                AuditLog.resource_type == "task",
                AuditLog.resource_id == str(record_id),
            ).delete(synchronize_session=False)
            session.query(Task).filter(Task.id == record_id).delete(synchronize_session=False)


@pytest.fixture(autouse=True)
def untouched_dataset(has_database):
    """Nothing outside this file's own records may change.

    Sixty rows read twice is cheap, and it catches the one mistake a bulk
    suite can make that no other suite can: a selection wider than the test
    intended. Compared on the columns these tests write.
    """
    if not has_database:
        yield
        return

    from src.core.db import session_scope
    from src.models.business import Task

    def snapshot() -> dict[str, tuple[str, str]]:
        with session_scope() as session:
            return {
                task.reference: (task.status, task.priority)
                for task in session.query(Task).filter(Task.deleted_at.is_(None)).all()
                if not str(task.title or "").startswith("Bulk scratch")
            }

    before = snapshot()
    yield
    after = snapshot()
    moved = {
        reference: (was, after.get(reference))
        for reference, was in before.items()
        if reference in after and after[reference] != was
    }
    assert moved == {}, f"a bulk selection reached records this test does not own: {moved}"


@pytest.fixture()
def scratch(client, monkeypatch):
    """Three tasks this test owns, created through the API.

    Three because the interesting assertions are about *some* of a selection:
    two applied and one refused is the outcome this module exists to report,
    and it cannot be expressed with one row.
    """
    headers = _authenticate(monkeypatch)
    made = []
    for index in range(3):
        response = client.post(
            TASKS,
            json={"title": f"Bulk scratch {index}", "status": "NEW", "priority": "HIGH"},
            headers=headers,
        )
        assert response.status_code == 201, response.get_json()
        made.append(response.get_json())
    try:
        yield made
    finally:
        _erase([record["id"] for record in made])
