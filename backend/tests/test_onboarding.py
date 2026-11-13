"""Onboarding (§38): a checklist per role, and sample data that comes back out.

Worth asserting: each role gets its own steps; a step ticks itself off when the
person actually does the thing; a person's own answers stick; the card can be
dismissed; and loading sample data then removing it leaves exactly what was
there before — real records untouched.
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from src.config import Config
from src.core.db import session_scope
from src.services import onboarding as service
from tests.conftest import persona_claims

pytestmark = pytest.mark.database

PREFIX = Config.API_PREFIX
BASE = f"{PREFIX}/api/onboarding"


def _auth(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr("src.core.auth.verify_token",
                        lambda _token: persona_claims(username, role, sid=f"onb-{username}"))
    return {"Authorization": f"Bearer onb-{username}"}


def test_each_role_gets_its_own_checklist(client, monkeypatch):
    admin = client.get(BASE, headers=_auth(monkeypatch)).get_json()
    assert admin["role"] == "ADMINISTRATOR" and admin["can_load_samples"] is True
    assert {"invite", "roles", "integration", "sla"} <= {step["key"] for step in admin["steps"]}
    operator = client.get(BASE, headers=_auth(monkeypatch, "operator", "operator")).get_json()
    assert "triage" in {step["key"] for step in operator["steps"]}
    assert "invite" not in {step["key"] for step in operator["steps"]}
    assert operator["can_load_samples"] is False
    viewer = client.get(BASE, headers=_auth(monkeypatch, "user", "viewer")).get_json()
    assert [step["key"] for step in viewer["steps"]][:2] == ["profile", "favorite"]
    assert client.get(BASE).status_code == 401


def test_answers_stick_and_progress_counts_them(client, monkeypatch):
    headers = _auth(monkeypatch, "analyst", "analyst")
    done = client.post(f"{BASE}/steps/tour", json={"state": "done"}, headers=headers).get_json()
    tour = next(step for step in done["steps"] if step["key"] == "tour")
    assert tour["state"] == "done" and tour["completed_at"]
    skipped = client.post(f"{BASE}/steps/tour", json={"state": "skipped"}, headers=headers).get_json()
    assert next(s for s in skipped["steps"] if s["key"] == "tour")["state"] == "skipped"
    assert skipped["progress"]["done"] >= 1
    back = client.post(f"{BASE}/steps/tour", json={"state": "todo"}, headers=headers).get_json()
    assert next(s for s in back["steps"] if s["key"] == "tour")["state"] == "todo"
    assert client.post(f"{BASE}/steps/tour", json={"state": "maybe"}, headers=headers).status_code == 400
    assert client.post(f"{BASE}/steps/invite", json={"state": "done"}, headers=headers).status_code == 404


def test_a_step_ticks_itself_off_when_it_is_done(client, monkeypatch):
    headers = _auth(monkeypatch, "manager", "manager")
    before = client.get(BASE, headers=headers).get_json()
    comment_step = next(step for step in before["steps"] if step["key"] == "comment")
    assert comment_step["automatic"] is True

    from src.models.business import Task
    from src.models.content import Comment
    from src.models.identity import User

    with session_scope() as session:
        user = session.scalar(select(User).where(User.username == "manager"))
        task = session.scalar(select(Task).limit(1))
        session.add(Comment(resource_type="task", resource_id=str(task.id), author_id=user.id, body="Onboarding test"))
    after = client.get(BASE, headers=headers).get_json()
    step = next(step for step in after["steps"] if step["key"] == "comment")
    assert step["state"] == "done" and step["auto"] is True


def test_the_card_can_be_dismissed_and_brought_back(client, monkeypatch):
    headers = _auth(monkeypatch, "operator", "operator")
    assert client.post(f"{BASE}/dismiss", json={}, headers=headers).get_json()["dismissed"] is True
    assert client.post(f"{BASE}/dismiss", json={}, headers=headers).get_json()["dismissed"] is True
    assert client.post(f"{BASE}/dismiss", json={"dismissed": False}, headers=headers).get_json()["dismissed"] is False


@pytest.mark.parametrize("area,model", [("customers", "Customer"), ("tasks", "Task"), ("tickets", "Ticket"),
                                        ("projects", "Project"), ("orders", "Order"), ("devices", "Device")])
def test_sample_data_loads_tagged_and_removes_exactly_what_it_added(client, monkeypatch, area, model):
    import src.models as models

    table = getattr(models, model)
    headers = _auth(monkeypatch)
    with session_scope() as session:
        before = session.scalar(select(func.count()).select_from(table).where(table.deleted_at.is_(None)))
    loaded = client.post(f"{BASE}/samples/{area}", headers=headers)
    assert loaded.status_code == 201, loaded.get_json()
    body = loaded.get_json()
    assert body["created"] > 0
    assert next(a for a in body["areas"] if a["key"] == area)["loaded"] == body["created"]
    assert client.post(f"{BASE}/samples/{area}", headers=headers).status_code == 400
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(table).where(table.deleted_at.is_(None))) == before + body["created"]
    removed = client.delete(f"{BASE}/samples/{area}", headers=headers).get_json()
    assert removed["removed"] + removed["hidden"] == body["created"]
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(table).where(table.deleted_at.is_(None))) == before


def test_sample_data_is_for_administrators(client, monkeypatch):
    headers = _auth(monkeypatch, "manager", "manager")
    assert client.get(f"{BASE}/samples", headers=headers).status_code == 403
    assert client.post(f"{BASE}/samples/tasks", headers=headers).status_code == 403
    admin = _auth(monkeypatch)
    assert client.post(f"{BASE}/samples/nothing", headers=admin).status_code == 404
    assert client.delete(f"{BASE}/samples/nothing", headers=admin).status_code == 404
    assert {a["key"] for a in client.get(f"{BASE}/samples", headers=admin).get_json()["areas"]} == set(service.AREAS)


def test_a_sample_record_something_real_points_at_is_hidden_not_broken(client, monkeypatch):
    from src.models.business import Project, Task
    from src.models.onboarding import SampleRecord

    headers = _auth(monkeypatch)
    client.post(f"{BASE}/samples/projects", headers=headers)
    with session_scope() as session:
        tag = session.scalar(select(SampleRecord).where(SampleRecord.area == "projects").limit(1))
        real = session.scalar(select(Task).where(Task.deleted_at.is_(None)).limit(1))
        real.project_id = tag.record_id
        project_id = tag.record_id
    removed = client.delete(f"{BASE}/samples/projects", headers=headers).get_json()
    assert removed["hidden"] >= 1
    with session_scope() as session:
        assert session.get(Project, project_id).deleted_at is not None


def test_the_seed_answers_for_the_personas_once():
    from src.seed import onboarding as seed

    with session_scope() as session:
        seed.populate(session)
        assert seed.populate(session) == {"answers": 0}
        session.rollback()


def test_a_check_that_cannot_run_counts_as_not_done(monkeypatch):
    from src.core.auth import Principal
    from src.models.identity import User

    def broken(_session, _user):
        raise RuntimeError("no")

    monkeypatch.setitem(service.S, "tour", service.Step("tour", "t", "d", "/", "a", None, broken))
    with session_scope() as session:
        user = session.scalar(select(User).where(User.username == "user"))
        principal = Principal(user_id=user.id, subject="", email="", username="user", full_name="Uma",
                              role_code="VIEWER", permissions=frozenset({"records.view"}))
        steps = service.checklist(session, principal=principal)["steps"]
        assert next(s for s in steps if s["key"] == "tour")["state"] == "todo"
