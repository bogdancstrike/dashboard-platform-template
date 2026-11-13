"""The AI assistant (§41–46): conversations, streamed turns, Data-mode tools,
described filters, the daily brief and page help — all against the fake model. — Conversations."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from src.config import Config
from src.core import llm
from tests.assistant_support import (  # noqa: F401
    BASE,
    _auth,
    _events,
    _new,
    _principal,
    _script,
)


def test_every_endpoint_needs_a_token(client):
    assert client.get(f"{BASE}/conversations").status_code == 401
    assert client.post(f"{BASE}/filters", json={}).status_code == 401
    assert client.get(f"{BASE}/brief").status_code == 401


@pytest.mark.database
def test_conversation_lifecycle(client, monkeypatch):
    h = _auth(monkeypatch)
    convo = _new(client, h)
    assert convo["title"] == "New conversation" and convo["mode"] == "general" and convo["messages"] == []
    named = _new(client, h, title="  Refund   questions ", mode="data")
    assert named["title"] == "Refund questions" and named["mode"] == "data"

    listed = client.get(f"{BASE}/conversations", headers=h).get_json()
    assert {named["id"], convo["id"]} <= {c["id"] for c in listed["items"]}
    found = client.get(f"{BASE}/conversations?q=refund", headers=h).get_json()
    assert [c["id"] for c in found["items"]] == [named["id"]]

    url = f"{BASE}/conversations/{convo['id']}"
    patched = client.patch(url, json={"title": "Renamed", "mode": "data"}, headers=h).get_json()
    assert patched["title"] == "Renamed" and patched["mode"] == "data"
    assert client.patch(url, json={"mode": "chaos"}, headers=h).status_code == 400
    assert client.patch(url, json={"title": "   "}, headers=h).status_code == 400
    assert client.post(f"{BASE}/conversations", json={"mode": "x"}, headers=h).status_code == 400

    # Private: another person gets "not there", not "not yours".
    other = _auth(monkeypatch, "manager", "manager")
    assert client.get(url, headers=other).status_code == 404
    assert client.delete(url, headers=other).status_code == 404

    h = _auth(monkeypatch)
    assert client.get(f"{BASE}/conversations/not-a-uuid", headers=h).status_code in (400, 404)
    assert client.delete(url, headers=h).get_json() == {"id": convo["id"], "deleted": True}
    assert client.get(url, headers=h).status_code == 404


@pytest.mark.database
def test_a_general_turn_streams_and_is_saved(client, monkeypatch):
    h = _auth(monkeypatch)
    convo = _new(client, h)
    _script("Hello **there** — this is a streamed answer.")
    response = client.post(f"{BASE}/conversations/{convo['id']}/messages",
                           json={"content": "Say hello to me please, nicely and at some length today, with feeling"}, headers=h)
    assert response.status_code == 200 and response.mimetype == "text/event-stream"
    events = _events(response)
    kinds = [k for k, _ in events]
    assert kinds[0] == "start" and kinds[-1] == "done" and "delta" in kinds
    assert "".join(d["text"] for k, d in events if k == "delta") == "Hello **there** — this is a streamed answer."
    saved = events[-1][1]["message"]
    assert saved["role"] == "assistant" and saved["status"] == "complete"
    assert saved["usage"]["total_tokens"] > 0

    detail = client.get(f"{BASE}/conversations/{convo['id']}", headers=h).get_json()
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]
    assert detail["title"].startswith("Say hello to me") and detail["title"].endswith("…")
    assert detail["message_count"] == 2

    # Regenerate replaces the last answer rather than adding a second.
    _script("A second answer.")
    again = _events(client.post(f"{BASE}/conversations/{convo['id']}/messages", json={"regenerate": True}, headers=h))
    assert again[-1][1]["message"]["content"] == "A second answer."
    detail = client.get(f"{BASE}/conversations/{convo['id']}", headers=h).get_json()
    assert [m["content"] for m in detail["messages"] if m["role"] == "assistant"] == ["A second answer."]

    usage = client.get(f"{BASE}/usage", headers=h).get_json()
    assert usage["calls"] >= 2 and usage["real"] is False
    # Not necessarily first: the shared database also has today's briefs.
    assert "chat" in {row["feature"] for row in usage["by_feature"]}


@pytest.mark.database
def test_turn_validation(client, monkeypatch):
    h = _auth(monkeypatch)
    convo = _new(client, h)
    url = f"{BASE}/conversations/{convo['id']}/messages"
    assert client.post(url, json={"content": "  "}, headers=h).status_code == 400
    assert client.post(url, json={"content": "x" * 9000}, headers=h).status_code == 400
    assert client.post(url, json={"regenerate": True}, headers=h).status_code == 400
    assert client.post(url, json={"content": "hi", "mode": "nope"}, headers=h).status_code == 400


@pytest.mark.database
def test_data_mode_calls_tools_and_cites_records(client, monkeypatch):
    h = _auth(monkeypatch)
    convo = _new(client, h, mode="data")
    tree = {"type": "group", "properties": {"conjunction": "AND"}, "children1": [
        {"type": "rule", "properties": {"field": "status", "operator": "in", "value": [["OPEN", "ASSIGNED"]]}}]}
    call = llm.ChatResult(text="", tool_calls=[llm.ToolCall("c1", "search_records",
                                                            {"dataset": "ticket", "condition_tree": tree, "limit": 3})])

    def answer(messages, tools):
        rows = json.loads(messages[-1]["content"])["rows"]
        return f"The first open ticket is [{rows[0]['reference']}](/tickets/{rows[0]['id']})."

    fake = _script(call, answer)
    events = _events(client.post(f"{BASE}/conversations/{convo['id']}/messages",
                                 json={"content": "Which tickets are open?"}, headers=h))
    tools = [d for k, d in events if k == "tool"]
    assert [t["status"] for t in tools] == ["running", "done"] and tools[1]["summary"].startswith("Found")
    message = events[-1][1]["message"]
    assert message["steps"][0]["name"] == "search_records"
    assert len(message["citations"]) == 1 and message["citations"][0]["path"].startswith("/tickets/")
    assert message["citations"][0]["id"] in message["content"]
    # Data mode tells the model about the datasets and hands it the tools.
    assert "DATA MODE" in fake.calls[0]["messages"][0]["content"]
    assert {t["function"]["name"] for t in fake.calls[0]["tools"]} >= {"search_records", "count_records"}


@pytest.mark.database
def test_tool_rounds_are_bounded(client, monkeypatch):
    from src.services.ai import assistant as service

    h = _auth(monkeypatch)
    convo = _new(client, h, mode="data")
    loop = [llm.ChatResult(text="", tool_calls=[llm.ToolCall(f"c{i}", "global_search", {"text": "acme"})])
            for i in range(service.MAX_ROUNDS)]
    fake = _script(*loop, "Enough looking.")
    events = _events(client.post(f"{BASE}/conversations/{convo['id']}/messages",
                                 json={"content": "Search forever"}, headers=h))
    assert events[-1][1]["message"]["content"].endswith("Enough looking.")
    assert fake.calls[-1]["tools"] is None  # the last round may only answer


@pytest.mark.database
def test_a_model_failure_is_an_error_event_and_saved(client, monkeypatch):
    h = _auth(monkeypatch)
    convo = _new(client, h)

    def boom(messages, tools):
        raise llm.LlmError("LLM_TIMEOUT", "slow", retryable=True)

    _script(boom)
    events = _events(client.post(f"{BASE}/conversations/{convo['id']}/messages", json={"content": "hi"}, headers=h))
    assert events[-1][0] == "error" and events[-1][1]["message"] == "The assistant took too long — try again."
    assert events[-1][1]["message_saved"]["status"] == "error"


@pytest.mark.database
def test_stopping_saves_what_was_written(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.assistant import AssistantMessage
    from src.services.ai import assistant as service

    h = _auth(monkeypatch)
    convo = _new(client, h)
    principal = _principal()
    _script("one two three four five six seven eight nine ten eleven twelve")
    with session_scope() as session:
        turn = service.begin_turn(session, convo["id"], {"content": "count"}, principal=principal)
    stream = service.stream_turn(turn, principal=principal)
    next(stream)  # start
    next(stream)  # the first words
    stream.close()  # the reader pressed Stop
    with session_scope() as session:
        saved = session.scalars(select(AssistantMessage).where(
            AssistantMessage.conversation_id == turn["conversation_id"], AssistantMessage.role == "assistant")).one()
        assert saved.status == "stopped" and saved.content == "one two three fo"


@pytest.mark.database
def test_rate_limit_and_permission(client, monkeypatch):
    from src.core.db import session_scope
    from src.core.errors import ForbiddenError, RateLimitedError
    from src.services.ai import assistant as service
    from src.services.ai import usage as ai

    h = _auth(monkeypatch)
    convo = _new(client, h)
    monkeypatch.setattr(Config, "LLM_RATE_PER_MINUTE", 1)
    _events(client.post(f"{BASE}/conversations/{convo['id']}/messages", json={"content": "one"}, headers=h))
    refused = client.post(f"{BASE}/conversations/{convo['id']}/messages", json={"content": "two"}, headers=h)
    assert refused.status_code == 429 and refused.get_json()["error"] == "rate_limited"

    nobody = _principal(permissions=("records.view",))
    with session_scope() as session:
        with pytest.raises(ForbiddenError):
            service.list_conversations(session, {}, principal=nobody)
        with pytest.raises(ForbiddenError):
            ai.guard(session, nobody, "chat")
        monkeypatch.setattr(Config, "LLM_RATE_PER_MINUTE", 1000)
        ai.guard(session, _principal(), "chat")
        with pytest.raises(RateLimitedError):
            monkeypatch.setattr(Config, "LLM_RATE_PER_MINUTE", 1)
            ai.guard(session, _principal(), "chat")
