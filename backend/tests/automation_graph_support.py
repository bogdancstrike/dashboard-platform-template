"""Shared helpers and fixtures for the automation graph tests."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.config import Config
from src.core.db import session_scope
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


pytestmark_db = pytest.mark.database
