"""The spreadsheet grid's save (§18): many rows, each with its own changes.

The claims:

* **Each row is reported on**: applied with the fields that moved, unchanged,
  or failed with *every* refused field — so the grid can mark the cells.
* **One refusal does not undo the others**, and a lost race is per row.
* **The same permission, coercion and audit** as a single edit.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
TASKS = f"{PREFIX}/api/records/task"
BULK = f"{TASKS}/bulk"

pytestmark = pytest.mark.database


def _auth(monkeypatch, username: str = "admin", role: str = "administrator") -> dict[str, str]:
    monkeypatch.setattr("src.core.auth.tokens.verify_token",
                        lambda _t: persona_claims(username, role, sid=f"grid-{username}"))
    return {"Authorization": f"Bearer grid-{username}"}


@pytest.fixture()
def headers(monkeypatch):
    return _auth(monkeypatch)


@pytest.fixture()
def tasks(client, headers):
    made = []
    for title in ("Grid probe A", "Grid probe B", "Grid probe C"):
        response = client.post(TASKS, json={"title": title, "priority": "LOW", "progress": 0}, headers=headers)
        assert response.status_code == 201
        made.append(response.get_json())
    return made


def test_each_row_is_saved_and_reported(client, headers, tasks):
    a, b, c = tasks
    response = client.post(BULK, json={"rows": [
        {"id": a["id"], "changes": {"priority": "high", "progress": "40"}},
        {"id": b["id"], "changes": {"priority": "LOW"}},
        {"id": c["id"], "changes": {"priority": "URGENTISH", "progress": 400, "title": "ok"}},
        {"id": str(uuid4()), "changes": {"title": "ghost"}},
    ]}, headers=headers)
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert (body["requested"], body["applied"], body["unchanged"], len(body["failed"])) == (4, 1, 1, 2)
    by_id = {r["id"]: r for r in body["results"]}
    assert by_id[a["id"]]["status"] == "applied"
    assert by_id[a["id"]]["changed"] == ["priority", "progress"]
    assert by_id[a["id"]]["updated_at"]
    assert by_id[b["id"]]["status"] == "unchanged"
    failed = by_id[c["id"]]
    assert failed["status"] == "failed"
    assert {p["field"] for p in failed["problems"]} == {"priority", "progress"}
    assert failed["message"] == "2 values refused."
    ghost = [r for r in body["results"] if r.get("error") == "not_found"]
    assert len(ghost) == 1
    assert "could not be updated" in body["message"]
    # The good row really changed, the refused one did not change at all.
    record = client.get(f"{TASKS}/{c['id']}", headers=headers).get_json()
    assert record["title"] == "Grid probe C"


def test_a_lost_race_fails_that_row_alone(client, headers, tasks):
    a, b, _ = tasks
    body = client.post(BULK, json={"rows": [
        {"id": a["id"], "changes": {"progress": 10}, "expected_updated_at": "2001-01-01T00:00:00Z"},
        {"id": b["id"], "changes": {"progress": 20}},
    ]}, headers=headers).get_json()
    by_id = {r["id"]: r for r in body["results"]}
    assert by_id[a["id"]]["status"] == "failed"
    assert by_id[a["id"]]["error"] == "conflict"
    assert by_id[b["id"]]["status"] == "applied"


@pytest.mark.parametrize("payload", [
    {"rows": []},
    {"rows": "all"},
    {"rows": [{"id": str(uuid4())}]},
    {"rows": [{"id": "nope", "changes": {}}]},
])
def test_a_malformed_save_is_refused(client, headers, payload):
    assert client.post(BULK, json=payload, headers=headers).status_code == 400


def test_more_than_the_cap_is_refused(client, headers, monkeypatch):
    from src.services.records import bulk

    monkeypatch.setattr(bulk, "MAX_ROWS", 1)
    response = client.post(BULK, json={"rows": [
        {"id": str(uuid4()), "changes": {}}, {"id": str(uuid4()), "changes": {}}]}, headers=headers)
    assert response.status_code == 400
    assert response.get_json()["details"]["limit"] == 1


def test_a_reader_cannot_save(client, monkeypatch, tasks):
    viewer = _auth(monkeypatch, "user", "viewer")
    response = client.post(BULK, json={"rows": [{"id": tasks[0]["id"], "changes": {"progress": 5}}]}, headers=viewer)
    assert response.status_code == 403


def test_every_saved_row_is_audited_like_an_edit(client, headers, tasks):
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.platform import AuditLog

    client.post(BULK, json={"rows": [{"id": t["id"], "changes": {"status": "IN_PROGRESS"}} for t in tasks]},
                headers=headers)
    with session_scope() as session:
        actions = session.scalars(select(AuditLog.action).where(
            AuditLog.resource_id.in_([t["id"] for t in tasks]), AuditLog.action == "STATUS_CHANGE")).all()
    assert len(actions) == 3
