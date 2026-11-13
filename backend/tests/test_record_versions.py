"""Record version history with point-in-time restore (§17).

The claims:

* **Versions are full states rebuilt from the audit trail**, oldest first,
  numbered, the last equal to the record as it is now.
* **Any two compare side by side**, and "as of" picks the version in force.
* **Restore is an audited write** — a whole version or chosen fields, under
  the edit permission and `records.restore`, with the form's coercion, a lost
  race refused, and the result itself a new version.
* **A record older than its trail still has a beginning** ("earliest recorded").
"""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest

from src.config import Config
from src.core.clock import now
from src.services.records import versions as service
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
TASKS = f"{PREFIX}/api/records/task"

pytestmark = pytest.mark.database


def _auth(monkeypatch, username: str = "admin", role: str = "administrator") -> dict[str, str]:
    monkeypatch.setattr("src.core.auth.tokens.verify_token",
                        lambda _t: persona_claims(username, role, sid=f"versions-{username}"))
    return {"Authorization": f"Bearer versions-{username}"}


@pytest.fixture()
def headers(monkeypatch):
    return _auth(monkeypatch)


@pytest.fixture()
def task(client, headers):
    """A task with three versions: created, re-prioritised, renamed and progressed."""
    made = client.post(TASKS, json={"title": "Version probe", "priority": "LOW", "progress": 10}, headers=headers)
    assert made.status_code == 201, made.get_json()
    ident = made.get_json()["id"]
    assert client.put(f"{TASKS}/{ident}", json={"priority": "HIGH"}, headers=headers).status_code == 200
    assert client.put(f"{TASKS}/{ident}", json={"title": "Version probe, renamed", "progress": 60},
                      headers=headers).status_code == 200
    return ident


def _versions(client, headers, ident, query=""):
    response = client.get(f"{TASKS}/{ident}/versions{query}", headers=headers)
    assert response.status_code == 200, response.get_json()
    return response.get_json()


def test_versions_need_a_token(client):
    assert client.get(f"{TASKS}/{uuid4()}/versions").status_code == 401


def test_each_write_is_a_full_version(client, headers, task):
    body = _versions(client, headers, task)
    versions = body["versions"]
    assert [v["action"] for v in versions] == ["CREATE", "UPDATE", "UPDATE"]
    assert [v["number"] for v in versions] == [1, 2, 3]
    assert body["current"] == 3
    first, second, third = (v["state"] for v in versions)
    assert (first["title"], first["priority"], first["progress"]) == ("Version probe", "LOW", 10)
    assert (second["title"], second["priority"]) == ("Version probe", "HIGH")
    assert (third["title"], third["progress"]) == ("Version probe, renamed", 60)
    assert versions[2]["changed"] == ["progress", "title"]
    assert versions[0]["actor"] == "Ada Administrator"
    assert body["can_restore"] is True
    assert any(field["name"] == "priority" for field in body["fields"])


def test_as_of_picks_the_version_in_force(client, headers, task):
    body = _versions(client, headers, task)
    from urllib.parse import quote

    second_at = body["versions"][1]["at"]
    assert _versions(client, headers, task, f"?at={quote(second_at)}")["as_of"] == 2
    tomorrow = (now() + timedelta(days=1)).date().isoformat()
    assert _versions(client, headers, task, f"?at={tomorrow}")["as_of"] == 3
    early = client.get(f"{TASKS}/{task}/versions?at=2001-01-01", headers=headers)
    assert early.status_code == 404
    assert client.get(f"{TASKS}/{task}/versions?at=whenever", headers=headers).status_code == 400


def test_two_versions_compare_side_by_side(client, headers, task):
    body = client.get(f"{TASKS}/{task}/versions/compare?a=1&b=3", headers=headers).get_json()
    assert body["a"]["number"] == 1 and body["b"]["number"] == 3
    differing = {row["name"] for row in body["fields"] if row["differs"]}
    assert differing == {"title", "priority", "progress"}
    assert body["differences"] == 3
    default = client.get(f"{TASKS}/{task}/versions/compare", headers=headers).get_json()
    assert (default["a"]["number"], default["b"]["number"]) == (2, 3)
    assert client.get(f"{TASKS}/{task}/versions/compare?a=9", headers=headers).status_code == 404
    assert client.get(f"{TASKS}/{task}/versions/compare?a=x", headers=headers).status_code == 400


def test_restore_one_field_is_audited_and_becomes_a_version(client, headers, task):
    body = _versions(client, headers, task)
    restored = client.post(f"{TASKS}/{task}/versions/restore", json={
        "version": 1, "fields": ["priority"], "expected_updated_at": body["updated_at"],
    }, headers=headers)
    assert restored.status_code == 200, restored.get_json()
    result = restored.get_json()
    assert result["restored"] == ["priority"]
    assert result["message"] == "Restored 1 field from version 1."
    latest = result["history"]["versions"][-1]
    assert latest["action"] == "RESTORE"
    assert latest["restored_from"] == 1
    assert latest["state"]["priority"] == "LOW"
    assert latest["state"]["title"] == "Version probe, renamed"
    record = client.get(f"{TASKS}/{task}", headers=headers).get_json()
    assert next(f for f in record["fields"] if f["name"] == "priority")["value"] == "LOW"

    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.platform import AuditLog

    with session_scope() as session:
        row = session.scalars(select(AuditLog).where(AuditLog.resource_id == task, AuditLog.action == "RESTORE")).one()
        assert row.metadata_json["restored_version"] == 1
        assert row.metadata_json["fields"] == ["priority"]
        assert row.changes == {"priority": {"from": "HIGH", "to": "LOW"}}


def test_restore_a_whole_version_and_undo_it(client, headers, task):
    whole = client.post(f"{TASKS}/{task}/versions/restore", json={"version": 1}, headers=headers).get_json()
    assert set(whole["restored"]) == {"title", "priority", "progress"}
    current = whole["history"]["versions"][-1]["state"]
    assert current["title"] == "Version probe"
    # The restore is itself a version, so it can be undone.
    undo = client.post(f"{TASKS}/{task}/versions/restore", json={"version": 3}, headers=headers).get_json()
    assert undo["history"]["versions"][-1]["state"]["title"] == "Version probe, renamed"
    same = client.post(f"{TASKS}/{task}/versions/restore", json={"version": 3}, headers=headers).get_json()
    assert same["restored"] == []
    assert same["message"].startswith("Nothing to restore")


@pytest.mark.parametrize("payload,status", [
    ({}, 400),
    ({"version": "x"}, 400),
    ({"version": 99}, 404),
    ({"version": 1, "fields": []}, 400),
    ({"version": 1, "fields": ["colour"]}, 400),
    ({"version": 1, "expected_updated_at": "2001-01-01T00:00:00Z"}, 409),
    ({"version": 1, "expected_updated_at": "never"}, 400),
])
def test_restore_refuses_what_it_cannot_do(client, headers, task, payload, status):
    response = client.post(f"{TASKS}/{task}/versions/restore", json=payload, headers=headers)
    assert response.status_code == status, response.get_json()


def test_restore_needs_the_permission(client, monkeypatch, task):
    analyst = _auth(monkeypatch, "analyst", "analyst")
    assert client.get(f"{TASKS}/{task}/versions", headers=analyst).get_json()["can_restore"] is False
    refused = client.post(f"{TASKS}/{task}/versions/restore", json={"version": 1}, headers=analyst)
    assert refused.status_code == 403
    assert client.post(f"{TASKS}/{task}/versions/restore", json=[1], headers=analyst).status_code == 400


def test_a_reference_that_no_longer_exists_cannot_be_restored(client, headers, task):
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.platform import AuditLog

    with session_scope() as session:
        create = session.scalars(select(AuditLog).where(AuditLog.resource_id == task,
                                                        AuditLog.action == "CREATE")).one()
        create.state_after = {**create.state_after, "assignee_id": str(uuid4())}
        create.changes = {**(create.changes or {}), "assignee_id": {"from": None, "to": create.state_after["assignee_id"]}}
    response = client.post(f"{TASKS}/{task}/versions/restore", json={"version": 1, "fields": ["assignee_id"]},
                           headers=headers)
    assert response.status_code == 400
    assert "cannot be restored" in response.get_json()["message"]


def test_a_record_older_than_its_trail_starts_with_the_earliest_recorded(client, headers):
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.business import Task

    made = client.post(TASKS, json={"title": "Baseline probe", "priority": "LOW"}, headers=headers).get_json()
    client.put(f"{TASKS}/{made['id']}", json={"priority": "CRITICAL"}, headers=headers)
    from src.models.platform import AuditLog

    with session_scope() as session:
        session.query(AuditLog).filter(AuditLog.resource_id == made["id"], AuditLog.action == "CREATE").delete()
        assert session.scalars(select(Task).where(Task.id == made["id"])).first()
    body = _versions(client, headers, made["id"])
    assert body["versions"][0]["action"] == "BASELINE"
    assert body["versions"][0]["state"]["priority"] == "LOW"
    assert body["versions"][1]["state"]["priority"] == "CRITICAL"


def test_references_are_named(client, headers):
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        manager = session.scalars(select(User).where(User.username == "manager")).first()
        manager_id, manager_name = str(manager.id), manager.full_name
    made = client.post(TASKS, json={"title": "Reference probe"}, headers=headers).get_json()
    client.put(f"{TASKS}/{made['id']}", json={"assignee_id": manager_id}, headers=headers)
    body = _versions(client, headers, made["id"])
    assert body["references"]["user"][manager_id] == manager_name


def test_contracts_have_versions_too(client, headers, monkeypatch):
    customer = client.post(f"{PREFIX}/api/explorer/query", json={
        "resource_type": "customer", "columns": ["name"], "page_size": 1}, headers=headers).get_json()["items"][0]
    made = client.post(f"{PREFIX}/api/contracts", json={
        "title": "Versioned contract", "customer_id": customer["id"], "value": 100,
        "start_date": "2026-01-01", "end_date": "2027-01-01",
    }, headers=headers).get_json()
    client.put(f"{PREFIX}/api/contracts/{made['id']}", json={"value": 250, "notes": "Upsell"}, headers=headers)
    base = f"{PREFIX}/api/records/contract/{made['id']}/versions"
    body = client.get(base, headers=headers).get_json()
    assert [v["state"]["value"] for v in body["versions"]] == [100.0, 250.0]
    assert body["references"]["customer"][customer["id"]] == customer["name"]
    restored = client.post(f"{base}/restore", json={"version": 1, "fields": ["value"]}, headers=headers).get_json()
    assert restored["restored"] == ["value"]
    assert restored["history"]["versions"][-1]["state"]["value"] == 100.0
    assert restored["history"]["versions"][-1]["state"]["notes"] == "Upsell"
    viewer = _auth(monkeypatch, "user", "viewer")
    assert client.post(f"{base}/restore", json={"version": 1}, headers=viewer).status_code == 403


def test_unknown_datasets_and_records(client, headers):
    assert client.get(f"{PREFIX}/api/records/planet/{uuid4()}/versions", headers=headers).status_code == 400
    assert client.get(f"{TASKS}/{uuid4()}/versions", headers=headers).status_code == 404
    assert client.get(f"{PREFIX}/api/records/contract/{uuid4()}/versions", headers=headers).status_code == 404


def test_touched_falls_back_to_the_states_when_there_is_no_diff():
    class Row:
        changes = None
        state_before = {"title": "a", "other": 1}
        state_after = None
        action = "UPDATE"

    assert service._touched(Row(), {"title": {}}) == {"title": "a"}

    class Bare(Row):
        state_before = None
        state_after = {"title": "b"}

    assert service._touched(Bare(), {"title": {}}) == {"title": None}
