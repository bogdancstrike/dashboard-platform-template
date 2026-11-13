"""Workflows as node graphs (§49): the canvas's definition, validation and engine. — Shape and meaning, without a database."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from src.core.db import session_scope
from src.core.errors import ValidationError
from src.services.automation import graph as graphs
from tests.automation_graph_support import (  # noqa: F401
    _graph,
    _tree,
    pytestmark_db,
)


@pytest.mark.parametrize("raw, message", [
    ("nope", "must be an object"),
    ({"nodes": "x"}, "list of nodes"),
    ({"nodes": [1]}, "must be an object"),
    ({"nodes": [{"id": "bad id!", "type": "trigger"}]}, "id of letters"),
    ({"nodes": [{"id": "a", "type": "trigger"}, {"id": "a", "type": "action"}]}, "share an id"),
    ({"nodes": [{"id": "a", "type": "robot"}]}, "not a kind of node"),
    ({"nodes": [{"id": "a", "type": "trigger"}], "edges": [1]}, "must be an object"),
    ({"nodes": [{"id": "a", "type": "trigger"}], "edges": [{"source": "a", "target": "z"}]}, "not in the graph"),
    ({"nodes": [{"id": f"n{i}", "type": "action"} for i in range(61)]}, "at most 60 nodes"),
    ({"nodes": [], "edges": [{}] * 121}, "at most 120"),
])
def test_a_shape_that_cannot_be_stored_is_refused(raw, message):
    with pytest.raises(ValidationError) as error:
        graphs.normalize(raw)
    assert message in error.value.message


def test_normalize_keeps_what_it_can_and_fixes_what_is_harmless():
    graph = graphs.normalize({
        "nodes": [{"id": "a", "type": "trigger", "position": {"x": "nan?", "y": 1e9}},
                  {"id": "b", "type": "action", "position": {"x": 12.345, "y": float("nan")}, "data": "x"}],
        "edges": [{"source": "a", "target": "b", "sourceHandle": "out", "id": "dup"},
                  {"source": "a", "target": "b", "id": "dup"}],
    })
    assert graph["nodes"][0]["position"] == {"x": 0.0, "y": 0.0}
    assert graph["nodes"][1]["position"] == {"x": 12.3, "y": 0.0}
    assert graph["nodes"][1]["data"] == {}
    assert [edge["id"] for edge in graph["edges"]] == ["dup", "dup-1"]
    assert graphs.trigger_of(graph)["id"] == "a"
    assert graphs.trigger_of({"nodes": []}) is None


@pytest.mark.parametrize("expression, moment, expected", [
    ("*/15 * * * *", datetime(2026, 1, 5, 10, 30), True),
    ("*/15 * * * *", datetime(2026, 1, 5, 10, 31), False),
    ("0 9 * * 1-5", datetime(2026, 1, 5, 9, 0), True),   # a Monday
    ("0 9 * * 1-5", datetime(2026, 1, 4, 9, 0), False),  # a Sunday
    ("0 9 * * 7", datetime(2026, 1, 4, 9, 0), True),     # 7 is Sunday too
    ("0 0 1 * 1", datetime(2026, 1, 5, 0, 0), True),     # either day field
    ("5,10-12 * * 1 *", datetime(2026, 1, 9, 3, 11), True),
    ("30/10 * * * *", datetime(2026, 1, 9, 3, 50), True),
])
def test_cron_matches_like_cron(expression, moment, expected):
    assert graphs.cron_matches(expression, moment) is expected


@pytest.mark.parametrize("bad", ["61 * * * *", "a * * * *", "5-1 * * * *", "* * *"])
def test_a_schedule_that_is_not_cron_is_refused(bad):
    with pytest.raises(ValidationError):
        graphs._cron(bad)


def test_cron_due_looks_back_at_most_a_day():
    until = datetime(2026, 1, 5, 9, 5, tzinfo=timezone.utc)
    assert graphs.cron_due("0 9 * * *", until - timedelta(minutes=10), until) is True
    assert graphs.cron_due("0 9 * * *", until - timedelta(minutes=2), until) is False
    assert graphs.cron_due("0 9 * * *", None, until.replace(minute=0)) is True
    assert graphs.cron_due("0 3 * * *", until - timedelta(days=9), until) is True


def test_a_straight_line_is_linear_and_a_branch_is_not():
    straight = graphs.normalize(_graph(actions=[{"kind": "TASK"}, {"kind": "TASK"}]))
    trigger, condition, actions = graphs.linear(straight)
    assert trigger["id"] == "t" and condition is None and [a["id"] for a in actions] == ["a0", "a1"]
    assert graphs.linear(graphs.normalize(_graph(branch=True))) is None
    waits = graphs.normalize(_graph(actions=[{"kind": "WAIT", "minutes": 5}]))
    assert graphs.linear(waits) is None
    orphan = graphs.normalize({**straight, "nodes": straight["nodes"] + [
        {"id": "x", "type": "action", "data": {"kind": "TASK"}}]})
    assert graphs.linear(orphan) is None
    assert graphs.linear({"nodes": [], "edges": []}) is None


def test_a_described_trigger_reads_as_a_sentence():
    assert graphs.describe_trigger(None) is None
    assert graphs.describe_trigger(_graph())["text"] == "Record created"
    changed = _graph("FIELD_CHANGED", extra={"field": "status", "to": "DONE"})
    assert graphs.describe_trigger(changed)["text"] == "status changes to DONE"
    assert graphs.describe_trigger(_graph("SCHEDULE", extra={"schedule": "0 9 * * *"}))["text"] == "Schedule 0 9 * * *"
    assert graphs.describe_trigger(_graph("FORM_SUBMITTED", extra={"form": "bug"}))["text"] == "Form bug submitted"


@pytestmark_db
def test_every_problem_is_named_on_its_node():
    graph = graphs.normalize({
        "nodes": [
            {"id": "t", "type": "trigger", "data": {"event": "SCHEDULE", "resource_type": "task",
                                                    "schedule": "nope"}},
            {"id": "t2", "type": "trigger", "data": {}},
            {"id": "c", "type": "condition", "data": {"tree": {}}},
            {"id": "b", "type": "branch", "data": {"tree": _tree("no_such_field")}},
            {"id": "a", "type": "action", "data": {"kind": "TELEPORT"}},
            {"id": "w", "type": "action", "data": {"kind": "WAIT", "minutes": 0}},
            {"id": "lonely", "type": "action", "data": {"kind": "TASK"}},
        ],
        "edges": [
            {"source": "t", "port": "out", "target": "c"},
            {"source": "t", "port": "out", "target": "b"},
            {"source": "c", "port": "nope", "target": "a"},
            {"source": "a", "port": "out", "target": "w"},
            {"source": "w", "port": "out", "target": "a"},
            {"source": "w", "port": "out", "target": "t2"},
        ],
    })
    with session_scope() as session:
        found = graphs.problems(session, graph)
    by_node: dict[str, list[str]] = {}
    for item in found:
        by_node.setdefault(item["node_id"], []).append(item["message"])
    assert any("exactly one trigger" in m for m in by_node["t2"])
    assert any("schedule" in m.lower() for m in by_node["t"])
    assert any("one condition" in m for m in by_node["t"])
    assert any("at least one rule" in m for m in by_node["c"])
    assert any("no 'nope' output" in m for m in by_node["c"])
    assert any("no_such_field" in m for m in by_node["b"])
    assert any("Connect the Yes or No" in m for m in by_node["b"])
    assert any("TELEPORT" in m for m in by_node["a"])
    assert any("one minute to thirty days" in m for m in by_node["w"])
    assert any("back into the trigger" in m for m in by_node["w"])
    assert any("loop" in m for item in found for m in [item["message"]])
    assert any("Not connected" in m for m in by_node["lonely"])


@pytestmark_db
def test_a_graph_needs_a_trigger_a_dataset_and_an_action():
    with session_scope() as session:
        assert graphs.problems(session, {"nodes": [], "edges": []})[0]["message"].startswith("A workflow starts")
        bare = graphs.normalize({"nodes": [{"id": "t", "type": "trigger", "data": {"event": "X"}}]})
        messages = [item["message"] for item in graphs.problems(session, bare)]
        assert any("Choose what starts" in m for m in messages)
        assert any("Choose the dataset" in m for m in messages)
        assert any("at least one action" in m for m in messages)
        unwired = graphs.normalize({"nodes": [
            {"id": "t", "type": "trigger", "data": {"event": "FIELD_CHANGED", "resource_type": "task"}},
            {"id": "f", "type": "trigger", "data": {"event": "FORM_SUBMITTED", "resource_type": "task",
                                                    "form": "no-such-form"}}]})
        messages = [item["message"] for item in graphs.problems(session, unwired)]
        assert any("Connect the trigger" in m for m in messages)
        assert any("which field" in m for m in messages)
        form = graphs.normalize({"nodes": [
            {"id": "t", "type": "trigger", "data": {"event": "FORM_SUBMITTED", "resource_type": "task",
                                                    "form": "no-such-form"}}]})
        assert any("form does not exist" in item["message"] for item in graphs.problems(session, form))
        unfinished = graphs.normalize(_graph(branch=True))
        unfinished["nodes"][1]["data"]["tree"] = {"type": "group", "children1": [
            {"type": "rule", "properties": {"field": "priority", "operator": "select_any_in", "value": []}}]}
        assert any("Finish the rules" in item["message"] for item in graphs.problems(session, unfinished))
        assert graphs.problems(session, graphs.normalize(_graph(branch=True))) == []


@pytestmark_db
@pytest.mark.parametrize("data, message", [
    ({"kind": "UPDATE_FIELD", "field": "nope", "value": 1}, "Choose a field"),
    ({"kind": "UPDATE_FIELD", "field": "priority"}, "Say what to set"),
    ({"kind": "UPDATE_FIELD", "field": "priority", "value": "PURPLE"}, "PURPLE"),
    ({"kind": "ASSIGN"}, "Choose who"),
    ({"kind": "CREATE_RECORD", "resource_type": "nothing"}, "Choose a dataset"),
    ({"kind": "CREATE_RECORD", "resource_type": "task", "values": {}}, "required"),
    ({"kind": "WAIT", "minutes": "soon"}, "how many minutes"),
    ({"kind": "EMAIL", "recipients": {"owner": True}, "template": "no-such-template"}, "No email template"),
    ({"kind": "NOTIFY"}, "who it reaches"),
])
def test_an_action_says_what_it_is_missing(data, message):
    from src.services.records.explorer import resources

    with session_scope() as session, pytest.raises(ValidationError) as error:
        graphs.clean_action(session, data, resources()["task"])
    assert message in error.value.message


@pytestmark_db
def test_actions_that_are_complete_are_cleaned():
    from src.services.records.explorer import resources

    task = resources()["task"]
    with session_scope() as session:
        assert graphs.clean_action(session, {"kind": "UPDATE_FIELD", "field": "title", "value": "{record}!"},
                                   task)["value"] == "{record}!"
        assert graphs.clean_action(session, {"kind": "ASSIGN", "to_owner": True}, task)["to_owner"] is True
        created = graphs.clean_action(session, {"kind": "CREATE_RECORD", "resource_type": "task",
                                                "values": {"title": "Follow up {record}"}}, None)
        assert created["resource_type"] == "task"
        approval = graphs.clean_action(session, {"kind": "APPROVAL", "title": "OK?", "body": "b",
                                                 "assignee_id": "11111111-1111-1111-1111-111111111111"}, task)
        assert approval["title"] == "OK?" and approval["assignee_id"]
        with pytest.raises(ValidationError):
            graphs.clean_action(session, {"kind": "UPDATE_FIELD", "field": "title", "value": "x"}, None)
        assert graphs.assignable_field(resources()["task"]) == "assignee_id"
