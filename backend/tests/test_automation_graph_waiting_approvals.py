"""Workflows as node graphs (§49): the canvas's definition, validation and engine. — Waiting, approvals and the scheduler."""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select

from src.core.db import session_scope
from src.core.errors import NotFoundError
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
