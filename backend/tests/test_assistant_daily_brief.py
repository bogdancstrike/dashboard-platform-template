"""The AI assistant (§41–46): conversations, streamed turns, Data-mode tools,
described filters, the daily brief and page help — all against the fake model. — The daily brief."""

from __future__ import annotations

import json
from datetime import timedelta

import pytest
from sqlalchemy import select

from src.core import llm
from src.core.clock import now
from tests.assistant_support import (  # noqa: F401
    BASE,
    PAGE,
    _auth,
    _fake_model,
    _notify,
    _principal,
    _script,
)


@pytest.mark.database
def test_the_brief_falls_back_caches_and_refreshes_with_the_model(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.assistant import AssistantBrief

    h = _auth(monkeypatch)
    admin = _principal()
    with session_scope() as session:
        session.query(AssistantBrief).filter(AssistantBrief.user_id == admin.user_id).delete()
    _notify(admin.user_id)

    first = client.get(f"{BASE}/brief", headers=h).get_json()
    assert first["source"] == "fallback" and first["items"] and first["headline"]
    assert all(i["link"].startswith("/") for i in first["items"])
    again = client.get(f"{BASE}/brief", headers=h).get_json()
    assert again["generated_at"] == first["generated_at"]  # cached for the day

    keys = [i["key"] for i in first["items"]]
    _script(json.dumps({"headline": "A calm day.", "items": [
        {"key": keys[0], "title": "Do this first", "reason": "Because.", "urgency": "high"},
        {"key": keys[0], "title": "Duplicate", "reason": "x"},
        {"key": "invented", "title": "Made up", "reason": "x"},
        "nonsense",
    ]}))
    fresh = client.post(f"{BASE}/brief", headers=h).get_json()
    assert fresh["source"] == "ai" and fresh["headline"] == "A calm day."
    assert [i["title"] for i in fresh["items"]] == ["Do this first"]  # invented and duplicate dropped
    assert fresh["items"][0]["urgency"] == "high" and fresh["total_tokens"] > 0

    def down(messages, tools):
        raise llm.LlmError("LLM_TIMEOUT", "x")

    _script(down)
    assert client.post(f"{BASE}/brief", headers=h).get_json()["source"] == "fallback"
    _script("not json at all")
    assert client.post(f"{BASE}/brief", headers=h).get_json()["source"] == "fallback"
    _script(json.dumps({"headline": "", "items": [{"key": "invented"}]}))
    assert client.post(f"{BASE}/brief", headers=h).get_json()["source"] == "fallback"


@pytest.mark.database
def test_the_brief_gathers_what_is_waiting():
    from src.core.db import session_scope
    from src.models.business import Task
    from src.services.ai import brief as brief

    admin = _principal()
    with session_scope() as session:
        session.add(Task(reference=f"TSK-T{now().microsecond:06d}", title="Overdue in test", status="NEW",
                         assignee_id=admin.user_id, requester_id=admin.user_id, due_date=now() - timedelta(days=2)))
        session.add(Task(reference=f"TSK-S{now().microsecond:06d}", title="Soon in test", status="IN_REVIEW",
                         assignee_id=admin.user_id, requester_id=admin.user_id, due_date=now() + timedelta(hours=5)))
    with session_scope() as session:
        gathered = brief.gather(session, admin)
    keys = {i["key"] for i in gathered["items"]}
    assert {"overdue", "due_soon", "approvals"} <= keys
    assert gathered["items"] == sorted(gathered["items"], key=lambda i: -i["score"])
    assert "opens_most" in gathered["signals"]
    empty = brief._fallback({"items": [], "signals": {}})
    assert empty == {"headline": "Nothing is waiting on you today.", "items": []}


@pytest.mark.database
def test_page_help_answers_highlights_and_proposes(client, monkeypatch):
    h = _auth(monkeypatch)
    _script(json.dumps({"answer": "Press **New task**.", "highlight": "new-task", "action": "tasks.new"}))
    body = client.post(f"{BASE}/page-help", json={**PAGE, "question": "How do I add a task?"}, headers=h).get_json()
    assert body == {"answer": "Press **New task**.", "highlight": "new-task",
                    "action": {"id": "tasks.new", "label": "Create a task"}, "source": "ai"}

    # Anything not on the page is dropped.
    _script(json.dumps({"answer": "Somewhere.", "highlight": "imaginary", "action": "rm -rf"}))
    body = client.post(f"{BASE}/page-help", json={**PAGE, "question": "How?"}, headers=h).get_json()
    assert body["highlight"] is None and body["action"] is None

    # Without a model: the matching tour stop, and the matching command.
    body = client.post(f"{BASE}/page-help", json={**PAGE, "question": "how do I filter by status"},
                       headers=h).get_json()
    assert body["source"] == "fallback" and body["highlight"] == "task-filters" and "Filter your work" in body["answer"]
    body = client.post(f"{BASE}/page-help", json={**PAGE, "question": "create something new"}, headers=h).get_json()
    assert body["action"]["id"] == "tasks.new"
    body = client.post(f"{BASE}/page-help", json={**PAGE, "question": "xylophone"}, headers=h).get_json()
    assert body["action"] is None and "could not find" in body["answer"]

    def down(messages, tools):
        raise llm.LlmError("LLM_UNAVAILABLE", "x")

    _script(down)
    assert client.post(f"{BASE}/page-help", json={**PAGE, "question": "filter status"}, headers=h).get_json()["source"] == "fallback"

    assert client.post(f"{BASE}/page-help", json={"question": ""}, headers=h).status_code == 400
    assert client.post(f"{BASE}/page-help", json={"question": "x" * 600}, headers=h).status_code == 400
    assert client.post(f"{BASE}/page-help", json=[1], headers=h).status_code == 400


@pytest.mark.database
def test_a_confirmed_action_is_audited(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.platform import AuditLog

    h = _auth(monkeypatch)
    response = client.post(f"{BASE}/page-help/actions", json={"command_id": "tasks.new", "label": "Create a task",
                                                              "path": "/tasks"}, headers=h)
    assert response.get_json() == {"recorded": True}
    with session_scope() as session:
        row = session.scalars(select(AuditLog).where(AuditLog.action == "AI_ACTION")
                              .order_by(AuditLog.occurred_at.desc())).first()
        assert row.resource_id == "tasks.new" and "Create a task" in row.message
    assert client.post(f"{BASE}/page-help/actions", json={}, headers=h).status_code == 400


@pytest.mark.database
def test_the_seed_is_idempotent_and_cites_real_records():
    from src.core.db import session_scope
    from src.models.assistant import AssistantConversation
    from src.seed import assistant as seed

    admin = _principal()
    with session_scope() as session:
        seed.seed(session)
        row = session.scalars(select(AssistantConversation).where(
            AssistantConversation.user_id == admin.user_id,
            AssistantConversation.title == "Release note for the November update")).one()
        session.delete(row)
    with session_scope() as session:
        assert seed.seed(session) == {"conversations": 1, "messages": 2}
        assert seed.seed(session) == {"conversations": 0, "messages": 0}
        data = session.scalars(select(AssistantConversation).where(
            AssistantConversation.user_id == admin.user_id, AssistantConversation.mode == "data")).first()
        cited = [c for m in data.messages for c in (m.citations or [])]
        assert cited and all(c["path"].startswith(("/tickets/", "/tasks/")) for c in cited)
    with session_scope() as session:
        seed.seed_safely(session)
