"""Workflows as node graphs (§49): the canvas's definition, validation and engine. — The API: create, draft, publish, versions."""

from __future__ import annotations

from sqlalchemy import select

from src.core.db import session_scope
from src.services.automation import graph as graphs
from tests.automation_graph_support import (  # noqa: F401
    PREFIX,
    RULES,
    TASKS,
    _auth,
    _create,
    _graph,
    _runs,
    _task,
    _tree,
    pytestmark_db,
)


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
