"""Workflows as node graphs (§49): the canvas's definition, validation and engine.

What is worth asserting is what makes a graph trustworthy:

  * a shape that cannot be stored is refused, and a meaning that cannot run is
    reported per node — so the canvas can paint every problem at once;
  * the form editor and the canvas edit one definition: a form edit becomes a
    new version of the graph, and a graph the form cannot show is refused by it;
  * a draft never runs; publishing makes a version, and versions restore;
  * a branch sends each record down the side its condition says, decided by the
    same compiled SQL the advanced search uses;
  * events fire workflows — create, edit, a field changing, a form, a webhook —
    and a workflow's own writes never fire another;
  * a delay and an approval park the record, and resume it from the right port.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from src.config import Config
from src.core.db import session_scope
from src.core.errors import NotFoundError, ValidationError
from src.services.automation import graph as graphs
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
RULES = f"{PREFIX}/api/automations/rules"
TASKS = f"{PREFIX}/api/records/task"


def _auth(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"graph-{username}"),
    )
    return {"Authorization": f"Bearer graph-{username}"}


def _tree(field: str = "priority", values: tuple[str, ...] = ("HIGH",)) -> dict:
    return {"type": "group", "conjunction": "AND", "children1": {
        "a": {"type": "rule", "properties": {
            "field": field, "operator": "select_any_in", "value": [list(values)]}}}}


def _graph(event: str = "RECORD_CREATED", *, branch: bool = False, extra: dict | None = None,
           actions: list[dict] | None = None) -> dict:
    trigger = {"id": "t", "type": "trigger", "position": {"x": 0, "y": 0},
               "data": {"event": event, "resource_type": "task", **(extra or {})}}
    notify = {"kind": "NOTIFY", "recipients": {"owner": True}, "title": "{rule}: {record}"}
    if branch:
        return {
            "nodes": [
                trigger,
                {"id": "b", "type": "branch", "position": {"x": 0, "y": 150}, "data": {"tree": _tree()}},
                {"id": "yes", "type": "action", "position": {"x": -150, "y": 300}, "data": notify},
                {"id": "no", "type": "action", "position": {"x": 150, "y": 300},
                 "data": {"kind": "UPDATE_FIELD", "field": "progress", "value": 5}},
            ],
            "edges": [
                {"id": "e1", "source": "t", "port": "out", "target": "b"},
                {"id": "e2", "source": "b", "port": "true", "target": "yes"},
                {"id": "e3", "source": "b", "port": "false", "target": "no"},
            ],
        }
    nodes = [trigger]
    edges = []
    previous = "t"
    for index, action in enumerate(actions or [notify]):
        node_id = f"a{index}"
        nodes.append({"id": node_id, "type": "action", "position": {"x": 0, "y": 150 * (index + 1)},
                      "data": action})
        edges.append({"id": f"e{index}", "source": previous, "port": "out", "target": node_id})
        previous = node_id
    return {"nodes": nodes, "edges": edges}


def _create(client, headers, graph: dict, **extra) -> dict:
    response = client.post(RULES, json={"name": "Graph test", "graph": graph, "enabled": True, **extra},
                           headers=headers)
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def _task(client, headers, **values) -> dict:
    response = client.post(TASKS, json={"title": "Graph task", "status": "NEW", "priority": "HIGH", **values},
                           headers=headers)
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def _runs(rule_id: str):
    from src.models.platform import AlertRuleRun

    with session_scope() as session:
        return [(row.fired, row.dry_run, dict(row.detail or {})) for row in session.scalars(
            select(AlertRuleRun).where(AlertRuleRun.rule_id == rule_id).order_by(AlertRuleRun.started_at)
        ).all()]


# ── Shape and meaning, without a database ────────────────────────────────


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


# ── Validation, per node ─────────────────────────────────────────────────

pytestmark_db = pytest.mark.database


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


# ── The API: create, draft, publish, versions ────────────────────────────


@pytestmark_db
def test_a_workflow_created_on_the_canvas_is_published_as_version_one(client, monkeypatch):
    headers = _auth(monkeypatch)
    rule = _create(client, headers, _graph(branch=True))
    assert rule["trigger"]["event"] == "RECORD_CREATED"
    assert rule["version"] == 1 and rule["linear"] is False
    detail = client.get(f"{RULES}/{rule['id']}/graph", headers=headers).get_json()
    assert detail["version"] == 1 and detail["dirty"] is False and detail["problems"] == []
    assert [v["version"] for v in detail["versions"]] == [1]
    # The columns the list reads are projected from the graph.
    assert rule["condition_text"] and "Priority" in rule["condition_text"]
    assert rule["action_summary"] == ["Notify people", "Update a field"]


@pytestmark_db
def test_a_canvas_workflow_with_problems_is_not_created(client, monkeypatch):
    headers = _auth(monkeypatch)
    graph = _graph()
    graph["edges"] = []
    response = client.post(RULES, json={"name": "Broken", "graph": graph}, headers=headers)
    assert response.status_code == 400
    assert response.get_json()["details"]["problems"]


@pytestmark_db
def test_a_draft_does_not_run_until_it_is_published(client, monkeypatch):
    headers = _auth(monkeypatch)
    rule = _create(client, headers, _graph())
    draft = _graph(actions=[{"kind": "TASK", "title": "Draft only"}])
    saved = client.put(f"{RULES}/{rule['id']}/graph", json={"graph": draft}, headers=headers).get_json()
    assert saved["dirty"] is True and saved["version"] == 1
    assert saved["published"]["nodes"][1]["data"]["kind"] == "NOTIFY"

    broken = _graph()
    broken["edges"] = []
    client.put(f"{RULES}/{rule['id']}/graph", json={"graph": broken}, headers=headers)
    refused = client.post(f"{RULES}/{rule['id']}/publish", json={}, headers=headers)
    assert refused.status_code == 400
    assert {item["node_id"] for item in refused.get_json()["details"]["problems"]} >= {"t"}

    client.put(f"{RULES}/{rule['id']}/graph", json={"graph": draft}, headers=headers)
    published = client.post(f"{RULES}/{rule['id']}/publish", json={"note": "Raise a task"},
                            headers=headers).get_json()
    assert published["version"] == 2 and published["dirty"] is False
    assert published["versions"][0]["note"] == "Raise a task"
    assert published["rule"]["action_summary"] == ["Raise a task"]

    restored = client.post(f"{RULES}/{rule['id']}/restore", json={"version": 1}, headers=headers).get_json()
    assert restored["dirty"] is True and restored["draft"]["nodes"][1]["data"]["kind"] == "NOTIFY"
    discarded = client.put(f"{RULES}/{rule['id']}/graph", json={"graph": None}, headers=headers).get_json()
    assert discarded["dirty"] is False
    assert client.post(f"{RULES}/{rule['id']}/restore", json={"version": 99}, headers=headers).status_code == 404
    assert client.post(f"{RULES}/{rule['id']}/restore", json={}, headers=headers).status_code == 400
    assert client.put(f"{RULES}/{rule['id']}/graph", json={}, headers=headers).status_code == 400


@pytestmark_db
def test_only_the_author_changes_a_graph(client, monkeypatch):
    admin = _auth(monkeypatch)
    rule = _create(client, admin, _graph())
    manager = _auth(monkeypatch, "manager", "manager")
    assert client.get(f"{RULES}/{rule['id']}/graph", headers=manager).get_json()["can_edit"] is False
    assert client.put(f"{RULES}/{rule['id']}/graph", json={"graph": _graph()},
                      headers=manager).status_code == 403
    viewer = _auth(monkeypatch, "user", "user")
    assert client.get(f"{RULES}/{rule['id']}/graph", headers=viewer).status_code == 403


@pytestmark_db
def test_the_form_editor_and_the_canvas_edit_one_definition(client, monkeypatch):
    headers = _auth(monkeypatch)
    created = client.post(RULES, json={
        "name": "Form built", "resource_type": "task", "condition_tree": _tree(),
        "actions": [{"kind": "NOTIFY", "recipients": {"owner": True}}],
    }, headers=headers).get_json()
    detail = client.get(f"{RULES}/{created['id']}/graph", headers=headers).get_json()
    assert [n["type"] for n in detail["published"]["nodes"]] == ["trigger", "condition", "action"]
    assert detail["published"]["nodes"][0]["data"]["event"] == "SCHEDULE"

    # A form edit is a new version of the same graph, ids kept.
    client.put(f"{RULES}/{created['id']}", json={"actions": [
        {"kind": "NOTIFY", "recipients": {"owner": True}}, {"kind": "TASK", "title": "x"}]}, headers=headers)
    detail = client.get(f"{RULES}/{created['id']}/graph", headers=headers).get_json()
    assert detail["version"] == 2
    assert [n["id"] for n in detail["published"]["nodes"]] == ["trigger", "condition", "action1", "action2"]
    assert detail["versions"][0]["note"] == "Edited in the form"

    # Branch it on the canvas, and the form can no longer change its shape.
    graph = _graph("SCHEDULE", branch=False, extra={"schedule": "0 9 * * *"})
    graph["nodes"].insert(1, {"id": "c", "type": "condition", "data": {"tree": _tree()}})
    graph["nodes"].append({"id": "w", "type": "action", "data": {"kind": "WAIT", "minutes": 10}})
    graph["edges"] = [{"source": "t", "port": "out", "target": "c"},
                      {"source": "c", "port": "out", "target": "a0"},
                      {"source": "a0", "port": "out", "target": "w"}]
    client.put(f"{RULES}/{created['id']}/graph", json={"graph": graph}, headers=headers)
    assert client.post(f"{RULES}/{created['id']}/publish", json={}, headers=headers).status_code == 200
    refused = client.put(f"{RULES}/{created['id']}", json={"actions": [{"kind": "TASK"}]}, headers=headers)
    assert refused.status_code == 400 and "canvas" in refused.get_json()["message"]
    # A rename is not a change of shape, and is fine.
    assert client.put(f"{RULES}/{created['id']}", json={"name": "Renamed"}, headers=headers).status_code == 200
    listed = client.get(RULES, headers=headers).get_json()["items"]
    mine = next(item for item in listed if item["id"] == created["id"])
    assert mine["trigger"]["text"] == "Schedule 0 9 * * *" and mine["linear"] is False


@pytestmark_db
def test_the_catalogue_offers_the_canvas_palette(client, monkeypatch):
    headers = _auth(monkeypatch)
    catalogue = client.get(f"{PREFIX}/api/automations/catalog", headers=headers).get_json()
    assert {a["kind"] for a in catalogue["actions"]} == {"NOTIFY", "EMAIL", "TASK", "WEBHOOK"}
    assert {"UPDATE_FIELD", "ASSIGN", "CREATE_RECORD"} <= {a["kind"] for a in catalogue["canvas_actions"]}
    assert {t["event"] for t in catalogue["triggers"]} == set(graphs.TRIGGERS)
    assert {f["kind"] for f in catalogue["flow"]} == {"WAIT", "APPROVAL"}
    assert catalogue["approvals"] is True and isinstance(catalogue["forms"], list)


# ── Test runs and samples ────────────────────────────────────────────────


@pytestmark_db
def test_a_test_run_reports_the_path_one_record_takes(client, monkeypatch):
    headers = _auth(monkeypatch)
    rule = _create(client, headers, _graph(branch=True), enabled=False)
    high = _task(client, headers, priority="HIGH")
    low = _task(client, headers, priority="LOW")

    samples = client.get(f"{RULES}/{rule['id']}/samples?q=Graph", headers=headers).get_json()["items"]
    assert any(item["id"] == high["id"] for item in samples)

    traced = client.post(f"{RULES}/{rule['id']}/test", json={"record_id": high["id"]}, headers=headers).get_json()
    assert [(n["node_id"], n["state"]) for n in traced["nodes"]] == [("t", "started"), ("b", "yes"), ("yes", "done")]
    assert traced["edges"] == ["e1", "e2"] and traced["actions"][0]["detail"].startswith("would")
    traced = client.post(f"{RULES}/{rule['id']}/test", json={"record_id": low["id"], "graph": "published"},
                         headers=headers).get_json()
    assert [n["node_id"] for n in traced["nodes"]] == ["t", "b", "no"]
    # Writes nothing: no run, no notification, no field set.
    assert _runs(rule["id"]) == []
    assert client.post(f"{RULES}/{rule['id']}/test", json={"record_id": "11111111-1111-1111-1111-111111111111"},
                       headers=headers).status_code == 404


# ── Events ───────────────────────────────────────────────────────────────


@pytestmark_db
def test_creating_a_record_fires_the_workflow_down_the_right_branch(client, monkeypatch):
    headers = _auth(monkeypatch)
    rule = _create(client, headers, _graph(branch=True))
    _task(client, headers, priority="HIGH")
    low = _task(client, headers, priority="LOW")
    runs = _runs(rule["id"])
    assert len(runs) == 2 and all(fired == 1 and not dry for fired, dry, _ in runs)
    assert runs[0][2]["nodes"]["b"] == {"in": 1, "true": 1}
    assert runs[1][2]["nodes"]["no"] == {"in": 1, "ok": 1}
    assert runs[1][2]["trigger"]["event"] == "RECORD_CREATED"
    # The "no" side set progress — written as the rule's author, through the records API.
    got = client.get(f"{TASKS}/{low['id']}", headers=headers).get_json()
    assert next(f for f in got["fields"] if f["name"] == "progress")["value"] in (5, 5.0, "5")
    # That write did not fire the workflow again (no third run).
    assert len(_runs(rule["id"])) == 2
    stats = client.get(f"{RULES}/{rule['id']}/graph", headers=headers).get_json()["stats"]
    assert stats["runs"] == 2 and stats["nodes"]["t"]["in"] == 2 and stats["edges"]["e1"] == 2


@pytestmark_db
def test_an_edit_and_a_field_change_fire_their_workflows(client, monkeypatch):
    headers = _auth(monkeypatch)
    updated = _create(client, headers, _graph("RECORD_UPDATED"))
    changed = _create(client, headers, _graph("FIELD_CHANGED", extra={"field": "status", "to": "DONE"},
                                              actions=[{"kind": "ASSIGN", "to_owner": True}]))
    paused = _create(client, headers, _graph("RECORD_UPDATED"), enabled=False)
    task = _task(client, headers)
    assert _runs(updated["id"]) == [] and _runs(changed["id"]) == []
    client.put(f"{TASKS}/{task['id']}", json={"status": "IN_PROGRESS"}, headers=headers)
    assert len(_runs(updated["id"])) == 1 and _runs(changed["id"]) == []
    client.put(f"{TASKS}/{task['id']}", json={"status": "DONE"}, headers=headers)
    assert len(_runs(changed["id"])) == 1 and _runs(paused["id"]) == []
    got = client.get(f"{TASKS}/{task['id']}", headers=headers).get_json()
    assert next(f for f in got["fields"] if f["name"] == "assignee_id")["value"]


@pytestmark_db
def test_create_record_and_a_failing_action_are_recorded(client, monkeypatch):
    headers = _auth(monkeypatch)
    rule = _create(client, headers, _graph(actions=[
        {"kind": "CREATE_RECORD", "resource_type": "task", "values": {"title": "Follow up {record}"}},
        {"kind": "UPDATE_FIELD", "field": "assignee_id", "value": "{record}"},
    ]))
    _task(client, headers, title="Seed of follow-up")
    (fired, _dry, detail), = _runs(rule["id"])
    actions = detail["sample"][0]["actions"]
    assert actions[0]["ok"] is True and actions[1]["ok"] is False
    assert detail["nodes"]["a1"]["failed"] == 1


@pytestmark_db
def test_a_form_submission_fires_a_form_trigger_only(monkeypatch):
    from src.core.auth import Principal
    from src.models.identity import User
    from src.services.records import writes as record_writes

    with session_scope() as session:
        owner = session.scalar(select(User).where(User.username == "admin"))
        principal = Principal(user_id=owner.id, subject="", email="", username="admin", full_name="Ada",
                              role_code="ADMINISTRATOR", permissions=frozenset({"automations.manage",
                                                                                  "records.view", "records.create"}))
        from src.models.platform import AlertRule

        rule = AlertRule(name="Form trigger", resource_type="task", enabled=True, owner_id=owner.id,
                         actions=[], cooldown_minutes=0)
        session.add(rule)
        session.flush()
        graphs.create_with_graph(session, rule, _graph("FORM_SUBMITTED", extra={"form": ""}),
                                 principal=principal)
        form_principal = Principal(user_id=owner.id, subject="", email="", username="form:bug-report",
                                   full_name="form", role_code="SYSTEM",
                                   permissions=frozenset({"records.view", "records.create"}))
        record_writes.create(session, "task", {"title": "From a form"}, principal=form_principal)
        record_writes.create(session, "task", {"title": "Typed in"}, principal=principal)
        assert rule.trigger_count == 1


@pytestmark_db
def test_a_webhook_trigger_runs_for_the_record_it_names(client, monkeypatch):
    headers = _auth(monkeypatch)
    rule = _create(client, headers, _graph("WEBHOOK"))
    detail = client.get(f"{RULES}/{rule['id']}/graph", headers=headers).get_json()
    path = detail["webhook_path"]
    assert path.startswith("/public/automations/hooks/")
    task = _task(client, headers, priority="LOW")
    answer = client.post(f"{PREFIX}{path}", json={"record_id": task["id"]})
    assert answer.status_code == 202 and answer.get_json()["fired"] == 1
    assert client.post(f"{PREFIX}/public/automations/hooks/nope", json={}).status_code == 404
    assert client.post(f"{PREFIX}{path}", json={"record_id": "11111111-1111-1111-1111-111111111111"}).status_code == 404
    client.put(f"{RULES}/{rule['id']}", json={"enabled": False}, headers=headers)
    assert client.post(f"{PREFIX}{path}", json={"record_id": task["id"]}).status_code == 400
    # Publishing again keeps the address.
    client.put(f"{RULES}/{rule['id']}/graph", json={"graph": _graph("WEBHOOK")}, headers=headers)
    again = client.post(f"{RULES}/{rule['id']}/publish", json={}, headers=headers).get_json()
    assert again["webhook_path"] == path


# ── Waiting, approvals and the scheduler ─────────────────────────────────


@pytestmark_db
def test_a_delay_parks_the_record_and_the_scheduler_resumes_it(client, monkeypatch):
    from src.models.automation_graphs import AutomationWait

    headers = _auth(monkeypatch)
    rule = _create(client, headers, _graph(actions=[
        {"kind": "WAIT", "minutes": 30}, {"kind": "NOTIFY", "recipients": {"owner": True}}]))
    task = _task(client, headers)
    (fired, _, detail), = _runs(rule["id"])
    assert fired == 1 and detail["parked"] == 1
    waiting = client.get(f"{RULES}/{rule['id']}", headers=headers).get_json()["waiting"]
    assert waiting[0]["kind"] == "DELAY" and waiting[0]["record_id"] == task["id"]

    assert client.post(f"{PREFIX}/api/automations/scheduler", headers=headers).get_json()["resumed"] == 0
    with session_scope() as session:
        wait = session.scalar(select(AutomationWait).where(AutomationWait.rule_id == rule["id"]))
        wait.due_at = wait.due_at - timedelta(hours=1)
    ran = client.post(f"{PREFIX}/api/automations/scheduler", headers=headers).get_json()
    assert ran["resumed"] == 1
    runs = _runs(rule["id"])
    assert len(runs) == 2 and runs[1][2]["trigger"]["event"] == "RESUME"
    assert runs[1][2]["nodes"]["a1"] == {"in": 1, "ok": 1}


@pytestmark_db
def test_an_approval_resumes_down_the_side_that_was_decided(client, monkeypatch):
    from src.models.automation_graphs import AutomationWait

    admin = _auth(monkeypatch)
    graph = _graph(actions=[{"kind": "APPROVAL", "title": "Approve {record}"}])
    graph["nodes"].append({"id": "ok", "type": "action", "data": {"kind": "UPDATE_FIELD", "field": "progress",
                                                                   "value": 100}})
    graph["nodes"].append({"id": "nope", "type": "action", "data": {"kind": "UPDATE_FIELD", "field": "progress",
                                                                     "value": 1}})
    graph["edges"] += [{"source": "a0", "port": "approved", "target": "ok"},
                       {"source": "a0", "port": "rejected", "target": "nope"}]
    rule = _create(client, admin, graph)

    traced_task = _task(client, admin)
    with session_scope() as session:
        wait = session.scalar(select(AutomationWait).where(AutomationWait.rule_id == rule["id"]))
        approval_id = wait.approval_id
    assert approval_id

    manager = _auth(monkeypatch, "manager", "manager")
    decided = client.post(f"{PREFIX}/api/approvals/{approval_id}/decision",
                          json={"decision": "reject"}, headers=manager)
    assert decided.status_code == 200, decided.get_data(as_text=True)
    admin = _auth(monkeypatch)
    got = client.get(f"{TASKS}/{traced_task['id']}", headers=admin).get_json()
    assert next(f for f in got["fields"] if f["name"] == "progress")["value"] in (1, 1.0, "1")
    with session_scope() as session:
        wait = session.scalar(select(AutomationWait).where(AutomationWait.approval_id == approval_id))
        assert wait.status == "RESUMED" and wait.outcome == "rejected"
    # A dry run takes the hopeful path and parks nothing.
    run = client.post(f"{RULES}/{rule['id']}/test", json={"record_id": traced_task["id"]},
                      headers=admin).get_json()
    assert [n["node_id"] for n in run["nodes"]] == ["t", "a0", "ok"]


@pytestmark_db
def test_resuming_a_wait_whose_record_or_rule_is_gone_cancels_it(client, monkeypatch):
    from src.models.automation_graphs import AutomationWait

    headers = _auth(monkeypatch)
    rule = _create(client, headers, _graph(actions=[{"kind": "WAIT", "minutes": 5}, {"kind": "TASK"}]))
    task = _task(client, headers)
    client.delete(f"{TASKS}/{task['id']}", headers=headers)
    with session_scope() as session:
        wait = session.scalar(select(AutomationWait).where(AutomationWait.rule_id == rule["id"]))
        assert graphs.resume(session, wait, "out") is None and wait.status == "CANCELLED"
        wait.status = "PENDING"
    with session_scope() as session:
        from src.models.platform import AlertRule

        row = session.get(AlertRule, rule["id"])
        row.deleted_at = row.created_at
        wait = session.scalar(select(AutomationWait).where(AutomationWait.rule_id == rule["id"]))
        assert graphs.resume(session, wait, "out") is None and wait.status == "CANCELLED"


@pytestmark_db
def test_a_scheduled_workflow_runs_when_its_cron_comes_due(client, monkeypatch):
    from src.models.automation_graphs import AutomationGraph

    headers = _auth(monkeypatch)
    graph = _graph("SCHEDULE", extra={"schedule": "* * * * *"})
    graph["nodes"].insert(1, {"id": "c", "type": "condition", "data": {"tree": _tree("reference", ("NONE-SUCH",))}})
    graph["edges"] = [{"source": "t", "port": "out", "target": "c"}, {"source": "c", "port": "out", "target": "a0"}]
    rule = _create(client, headers, graph)
    with session_scope() as session:
        row = session.scalar(select(AutomationGraph).where(AutomationGraph.rule_id == rule["id"]))
        row.last_scheduled_at = row.published_at - timedelta(minutes=5)
    result = client.post(f"{PREFIX}/api/automations/scheduler", headers=headers).get_json()
    assert result["scheduled"] >= 1
    runs = _runs(rule["id"])
    assert runs[-1][2]["trigger"]["event"] == "SCHEDULE"


@pytestmark_db
def test_run_now_on_a_canvas_workflow_walks_the_graph(client, monkeypatch):
    headers = _auth(monkeypatch)
    graph = _graph("SCHEDULE", extra={"schedule": "0 9 * * *"})
    graph["nodes"].insert(1, {"id": "c", "type": "condition", "data": {"tree": _tree("priority", ("CRITICAL",))}})
    graph["edges"] = [{"source": "t", "port": "out", "target": "c"}, {"source": "c", "port": "out", "target": "a0"}]
    rule = _create(client, headers, graph)
    _task(client, headers, priority="CRITICAL")
    run = client.post(f"{RULES}/{rule['id']}/run", json={"dry_run": True}, headers=headers).get_json()
    assert run["matched"] >= 1 and run["fired"] == run["matched"] - run["suppressed"] - run["deferred"]
    assert run["sample"][0]["state"] == "WOULD FIRE"


@pytestmark_db
def test_evaluation_of_a_graph_without_a_trigger_is_a_failed_run(client, monkeypatch):
    from src.models.automation_graphs import AutomationGraph
    from src.models.platform import AlertRule

    headers = _auth(monkeypatch)
    rule = _create(client, headers, _graph())
    with session_scope() as session:
        row = session.scalar(select(AutomationGraph).where(AutomationGraph.rule_id == rule["id"]))
        row.published = {"nodes": [], "edges": []}
    with session_scope() as session:
        answer = graphs.evaluate(session, session.get(AlertRule, rule["id"]), principal=None, dry_run=True)
    assert answer["error"] == "This workflow has no trigger."


@pytestmark_db
def test_missing_rules_and_records_are_not_found(client, monkeypatch):
    headers = _auth(monkeypatch)
    missing = "11111111-1111-1111-1111-111111111111"
    assert client.get(f"{RULES}/{missing}/graph", headers=headers).status_code == 404
    with session_scope() as session, pytest.raises(NotFoundError):
        graphs.fire_webhook(session, "", {})


def test_catch_up_never_runs_in_tests():
    assert graphs.catch_up() is False


@pytestmark_db
def test_a_canvas_workflow_starts_paused_unless_asked(client, monkeypatch):
    headers = _auth(monkeypatch)
    response = client.post(RULES, json={"name": "Starter", "graph": _graph()}, headers=headers)
    assert response.status_code == 201 and response.get_json()["enabled"] is False
