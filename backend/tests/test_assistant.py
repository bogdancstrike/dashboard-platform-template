"""The AI assistant (§41–46): conversations, streamed turns, Data-mode tools,
described filters, the daily brief and page help — all against the fake model.

No test here reaches a real model: every one installs a `FakeClient`, scripted
where the answer matters.
"""

from __future__ import annotations

import json
from datetime import timedelta

import pytest
from sqlalchemy import select

from src.config import Config
from src.core import llm
from src.core.auth import ALL_PERMISSIONS, Principal
from src.core.clock import now
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
BASE = f"{PREFIX}/api/assistant"


@pytest.fixture(autouse=True)
def _fake_model():
    llm.set_client(llm.FakeClient())
    yield
    llm.set_client(None)


def _script(*replies):
    fake = llm.FakeClient(script=list(replies))
    llm.set_client(fake)
    return fake


def _auth(monkeypatch, username="admin", role="administrator"):
    monkeypatch.setattr("src.core.auth.verify_token",
                        lambda _t: persona_claims(username, role, sid=f"ai-{username}"))
    return {"Authorization": f"Bearer ai-{username}"}


def _principal(username="admin", permissions=ALL_PERMISSIONS) -> Principal:
    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        user = session.scalars(select(User).where(User.username == username)).one()
        return Principal(user_id=user.id, subject="", email=user.email, username=username,
                         full_name=user.full_name, role_code="ADMINISTRATOR", permissions=frozenset(permissions))


def _events(response) -> list[tuple[str, dict]]:
    out = []
    for block in response.get_data(as_text=True).split("\n\n"):
        if not block.strip():
            continue
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def _new(client, headers, **body):
    response = client.post(f"{BASE}/conversations", json=body, headers=headers)
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


# ── Conversations ─────────────────────────────────────────────────────────


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
    assert usage["calls"] >= 2 and usage["by_feature"][0]["feature"] == "chat" and usage["real"] is False


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
    from src.services import assistant as service

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
    from src.services import assistant as service

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
    from src.services import ai, assistant as service

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


# ── Data-mode tools ───────────────────────────────────────────────────────


@pytest.mark.database
def test_tools_answer_through_the_callers_permissions():
    from src.core.db import session_scope
    from src.services import assistant_tools as tools

    admin = _principal()
    with session_scope() as session:
        out, cites, summary = tools.run(session, "count_records",
                                        {"dataset": "ticket", "group_by": "status", "metric": "avg",
                                         "metric_field": "reopen_count"}, principal=admin)
        data = json.loads(out)
        assert data["total"] > 0 and data["by"] == "status" and data["groups"][0]["count"] > 0
        assert data["metric"]["op"] == "avg" and summary.startswith("Counted") and cites == []

        rows = json.loads(tools.run(session, "search_records", {"dataset": "project", "text": "", "sort": "name",
                                                                "order": "asc", "limit": 2}, principal=admin)[0])
        first = rows["rows"][0]["id"]
        out, cites, summary = tools.run(session, "get_record", {"dataset": "project", "id": first}, principal=admin)
        assert json.loads(out)["id"] == first and cites[0]["path"] == f"/projects/{first}" and summary.startswith("Read")

        out, cites, summary = tools.run(session, "global_search", {"text": "a"}, principal=admin)
        assert "Searched everything" in summary

        assert "error" in json.loads(tools.run(session, "nope", {}, principal=admin)[0])
        assert "error" in json.loads(tools.run(session, "get_record", {"__invalid_json__": "x"}, principal=admin)[0])
        refused = json.loads(tools.run(session, "count_records", {"dataset": "unicorns"}, principal=admin)[0])
        assert "error" in refused
        bad = json.loads(tools.run(session, "count_records", {"dataset": "ticket", "group_by": "colour"},
                                   principal=admin)[0])
        assert "error" in bad
        bad = json.loads(tools.run(session, "count_records", {"dataset": "ticket", "metric": "sum",
                                                              "metric_field": "subject"}, principal=admin)[0])
        assert "error" in bad
        bad = json.loads(tools.run(session, "search_records", {"dataset": "ticket", "limit": "many"},
                                   principal=admin)[0])
        assert "error" in bad

        # Without records.view the datasets are not there to read.
        viewer = _principal(permissions=("ai.use",))
        assert tools.definitions(viewer)[0]["function"]["parameters"]["properties"]["dataset"]["enum"] == []
        assert "no datasets" in tools.catalogue_text(viewer)
        assert "error" in json.loads(tools.run(session, "search_records", {"dataset": "ticket"}, principal=viewer)[0])


# ── Described filters ─────────────────────────────────────────────────────


@pytest.mark.database
def test_a_described_filter_is_repaired_into_the_builder_tree(client, monkeypatch):
    h = _auth(monkeypatch)
    answer = {"explanation": "Open or assigned high-priority tickets of mine due soon.", "tree": {
        "type": "group", "properties": {"conjunction": "AND"}, "children1": [
            {"type": "rule", "properties": {"field": "statsu", "operator": "in", "value": [["open", "Assigned"]]}},
            {"type": "rule", "properties": {"field": "Priority", "operator": "is", "value": ["high"]}},
            {"type": "rule", "properties": {"field": "colour", "operator": "eq", "value": ["red"]}},
            {"type": "rule", "properties": {"field": "category", "operator": "contains", "value": ["billing"]}},
            {"type": "rule", "properties": {"field": "assignee_id", "operator": "eq", "value": ["@me"]}},
            {"type": "rule", "properties": {"field": "sla_breached", "operator": "eq", "value": ["yes"]}},
            {"type": "group", "properties": {"conjunction": "or"}, "children1": [
                {"type": "rule", "properties": {"field": "due_at", "operator": "between", "value": ["today", "+7d"]}},
                {"type": "rule", "properties": {"field": "reopen_count", "operator": "gte", "value": ["2"]}},
                {"type": "rule", "properties": {"field": "subject", "operator": "gt", "value": ["x"]}},
            ]},
        ]}}
    _script(json.dumps(answer))
    response = client.post(f"{BASE}/filters", json={"resource_type": "ticket", "question": "my urgent tickets",
                                                    "current_tree": answer["tree"]}, headers=h)
    assert response.status_code == 200, response.get_data(as_text=True)
    body = response.get_json()
    assert body["source"] == "ai" and body["resource_type"] == "ticket"
    rules = list(body["tree"]["children1"].values())
    by_field = {r["properties"]["field"]: r["properties"] for r in rules if r["type"] == "rule"}
    assert by_field["status"]["operator"] == "select_any_in" and by_field["status"]["value"] == [["OPEN", "ASSIGNED"]]
    assert by_field["priority"]["operator"] == "select_equals" and by_field["priority"]["value"] == ["HIGH"]
    assert by_field["category"]["operator"] == "select_equals" and by_field["category"]["value"] == ["BILLING"]
    assert by_field["assignee_id"]["value"] == [str(_principal().user_id)]
    assert by_field["sla_breached"]["value"] == [True] and by_field["sla_breached"]["valueType"] == ["boolean"]
    group = next(r for r in rules if r["type"] == "group")
    inner = {r["properties"]["field"]: r["properties"] for r in group["children1"].values()}
    assert group["properties"]["conjunction"] == "OR"
    assert inner["due_at"]["operator"] == "between" and len(inner["due_at"]["value"]) == 2
    assert inner["reopen_count"]["value"] == [2] and inner["reopen_count"]["operator"] == "greater_or_equal"
    assert "subject" not in inner  # text has no "greater than"
    assert "colour" not in by_field and any("colour" in n for n in body["notes"])
    assert body["rule_count"] == 7 and isinstance(body["match_count"], int) and "Status" in body["condition_text"]


@pytest.mark.database
def test_auto_dataset_fallback_and_errors(client, monkeypatch):
    h = _auth(monkeypatch)
    _script(json.dumps({"resource_type": "project", "tree": {"type": "rule", "properties": {
        "field": "status", "operator": "eq", "value": ["anything-not-a-choice"]}}}))
    body = client.post(f"{BASE}/filters", json={"resource_type": "auto", "question": "critical tickets assigned to me, overdue"},
                       headers=h).get_json()
    # The model's only rule was unusable, so the words are used instead — on the dataset it chose.
    assert body["resource_type"] == "project" and body["source"] == "fallback"

    # No model (the fake answers {}): the words alone.
    body = client.post(f"{BASE}/filters", json={"resource_type": "ticket",
                                                "question": "my open critical tickets that are overdue"},
                       headers=h).get_json()
    fields = {r["properties"]["field"] for r in body["tree"]["children1"].values()}
    assert {"status", "priority", "assignee_id", "due_at"} <= fields and body["source"] == "fallback"

    def down(messages, tools):
        raise llm.LlmError("LLM_UNAVAILABLE", "x", retryable=True)

    _script(down)
    assert client.post(f"{BASE}/filters", json={"resource_type": "task", "question": "done tasks"},
                       headers=h).get_json()["source"] == "fallback"

    def refused(messages, tools):
        raise llm.LlmError("LLM_INVALID_REQUEST", "x")

    _script(refused)
    assert client.post(f"{BASE}/filters", json={"resource_type": "task", "question": "x"}, headers=h).status_code == 503
    assert client.post(f"{BASE}/filters", json={"resource_type": "task", "question": " "}, headers=h).status_code == 400
    assert client.post(f"{BASE}/filters", json={"resource_type": "task", "question": "x" * 700},
                       headers=h).status_code == 400
    assert client.post(f"{BASE}/filters", json={"resource_type": "unicorn", "question": "x"},
                       headers=h).status_code == 400
    assert client.post(f"{BASE}/filters", json=[1], headers=h).status_code == 400


@pytest.mark.database
def test_values_resolve_names_and_dates():
    from src.core.db import session_scope
    from src.services import ai_filters as f
    from src.services.explorer import resources

    admin = _principal()
    today = now()
    task = resources()["task"]
    with session_scope() as session:
        from src.models.business import Project
        from src.models.identity import User

        person = session.scalars(select(User).where(User.username == "manager")).one()
        project = session.scalars(select(Project).limit(1)).one()
        spec = task.fields.by_name["assignee_id"]
        assert f.coerce_values(session, spec, "eq", [person.full_name.split()[0]], principal=admin, today=today)
        assert str(project.id) in f.coerce_values(session, task.fields.by_name["project_id"], "in", [project.name],
                                                  principal=admin, today=today)[0]
        assert f.coerce_values(session, spec, "eq", ["Nobody Like This Name"], principal=admin, today=today) is None
        assert f.coerce_values(session, spec, "empty", None, principal=admin, today=today) == []
        tree, notes = f.normalise({"type": "rule", "properties": {"field": "due_date", "operator": "between",
                                                                  "value": ["2026-01-05"]}}, task,
                                  session=session, principal=admin)
        rule = next(iter(tree["children1"].values()))
        assert rule["properties"]["operator"] == "greater_or_equal" and rule["properties"]["value"] == ["2026-01-05 00:00:00"]
        tree, notes = f.normalise("garbage", task, session=session, principal=admin)
        assert tree["children1"] == {}
        tree, notes = f.normalise({"type": "rule", "properties": {"field": "status", "operator": "wobble",
                                                                  "value": ["NEW"]}}, task, session=session,
                                  principal=admin)
        assert tree["children1"] == {} and notes


def test_value_helpers():
    from datetime import datetime, UTC

    from src.services import ai_filters as f

    today = datetime(2026, 11, 12, 15, 30, tzinfo=UTC)
    assert f._moment("today", today=today) == "2026-11-12 00:00:00"
    assert f._moment("now", today=today) == "2026-11-12 15:30:00"
    assert f._moment("tomorrow", today=today).startswith("2026-11-13")
    assert f._moment("yesterday", today=today).startswith("2026-11-11")
    assert f._moment("-2w", today=today).startswith("2026-10-29")
    assert f._moment("@today+1m", today=today).startswith("2026-12-12")
    assert f._moment("2026-03-04T10:00:00Z", today=today) == "2026-03-04 10:00:00"
    assert f._moment("2026-03-04 10:00", today=today) == "2026-03-04 10:00:00"
    assert f._moment("whenever", today=today) is None
    assert f._choice("in progress", ("NEW", "IN_PROGRESS")) == "IN_PROGRESS"
    assert f._choice("IN_PROGRES", ("NEW", "IN_PROGRESS")) == "IN_PROGRESS"
    assert f._choice("zzz", ("NEW",)) is None and f._choice("x", ()) == "x"
    assert f._boolean("no") is False and f._boolean(True) is True and f._boolean("maybe") is None
    assert f._number("1,200") == 1200 and f._number("2.5") == 2.5 and f._number("x") is None
    assert f._flat("a, b") == ["a", "b"] and f._flat(None) == [] and f._flat([["a"], None, ""]) == ["a"]
    assert f._flat("2026-01-01, 2026-02-01") == ["2026-01-01, 2026-02-01"]


def test_operator_and_field_resolution():
    from src.services import ai_filters as f
    from src.services.explorer import resources

    ticket = resources()["ticket"]
    fields = ticket.fields.by_name
    assert f.resolve_field("Due at", ticket).name == "due_at"
    assert f.resolve_field("SLA breached", ticket) is not None
    assert f.resolve_field("", ticket) is None and f.resolve_field("zzzz", ticket) is None
    assert f.resolve_operator("over", fields["reopen_count"], 1) == "gt"
    assert f.resolve_operator("contains", fields["status"], 2) == "in"
    assert f.resolve_operator("before", fields["status"], 1) is None
    assert f.resolve_operator("in", fields["due_at"], 2) == "eq"
    assert f.resolve_operator("not_in", fields["sla_breached"], 2) == "ne"
    assert f.resolve_operator("explode", fields["status"], 1) is None
    text = f.field_catalogue(ticket)
    assert "status (Status; enum; one of OPEN" in text and "refers to a user" in text
    tree = f.heuristic_tree("nothing in particular", ticket, principal=None)
    assert tree["children1"] == []


# ── The daily brief ───────────────────────────────────────────────────────


def _notify(user_id):
    from src.core.db import session_scope
    from src.models.platform import Notification

    with session_scope() as session:
        session.add(Notification(user_id=user_id, title="Something happened", is_read=False))


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
    from src.services import assistant_brief as brief

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


# ── Page help ─────────────────────────────────────────────────────────────

PAGE = {
    "path": "/tasks",
    "stops": [{"title": "Filter your work", "description": "Narrow the list by status and owner.", "target": "task-filters"}],
    "controls": [{"id": "new-task", "label": "New task"}, {"id": "", "label": "ignored"}],
    "commands": [{"id": "tasks.new", "label": "Create a task", "keywords": "add new task create"}],
}


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
