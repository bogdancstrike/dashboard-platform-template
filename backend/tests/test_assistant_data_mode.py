"""The AI assistant (§41–46): conversations, streamed turns, Data-mode tools,
described filters, the daily brief and page help — all against the fake model. — Data-mode tools."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from src.core import llm
from src.core.clock import now
from tests.assistant_support import (  # noqa: F401
    BASE,
    _auth,
    _principal,
    _script,
)


@pytest.mark.database
def test_tools_answer_through_the_callers_permissions():
    from src.core.db import session_scope
    from src.services.ai import tools as tools

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
    from src.services.ai import filters as f
    from src.services.records.explorer import resources

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
    from datetime import UTC, datetime

    from src.services.ai import filters as f

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
    from src.services.ai import filters as f
    from src.services.records.explorer import resources

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
