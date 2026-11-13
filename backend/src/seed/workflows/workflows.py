"""Seed data for workflows: _tree, _n, _e."""

from __future__ import annotations

from typing import Any


def _tree(field: str, values: tuple[str, ...]) -> dict[str, Any]:
    return {"type": "group", "conjunction": "AND", "children1": {
        "r1": {"type": "rule", "properties": {"field": field, "operator": "select_any_in",
                                               "value": [list(values)]}}}}


def _n(node_id: str, kind: str, x: float, y: float, data: dict[str, Any]) -> dict[str, Any]:
    return {"id": node_id, "type": kind, "position": {"x": x, "y": y}, "data": data}


def _e(source: str, target: str, port: str = "out") -> dict[str, Any]:
    return {"id": f"e-{source}-{port}-{target}", "source": source, "port": port, "target": target}


OWNER = {"recipients": {"owner": True}}


WORKFLOWS: tuple[dict[str, Any], ...] = (
    {
        "name": "Route urgent tickets to the on-call lead",
        "description": "New tickets: urgent and high go straight to a manager; the rest are acknowledged.",
        "severity": "CRITICAL",
        "graph": {
            "nodes": [
                _n("trigger", "trigger", 0, 0, {"event": "RECORD_CREATED", "resource_type": "ticket"}),
                _n("urgent", "branch", 0, 150, {"tree": _tree("priority", ("CRITICAL", "HIGH"))}),
                _n("page", "action", -170, 300, {"kind": "NOTIFY", "recipients": {"role": "MANAGER"},
                                                  "title": "Urgent ticket: {record}"}),
                _n("triage", "action", -170, 450, {"kind": "TASK", "title": "Triage {record} within the hour",
                                                    "priority": "CRITICAL"}),
                _n("ack", "action", 170, 300, {"kind": "EMAIL", **OWNER,
                                               "subject": "We have your request: {record}"}),
            ],
            "edges": [_e("trigger", "urgent"), _e("urgent", "page", "true"), _e("page", "triage"),
                      _e("urgent", "ack", "false")],
        },
    },
    {
        "name": "Chase tasks blocked for two days",
        "description": "When a task is marked blocked, wait two days, then remind its owner if it still is.",
        "severity": "WARNING",
        "graph": {
            "nodes": [
                _n("trigger", "trigger", 0, 0, {"event": "FIELD_CHANGED", "resource_type": "task",
                                                "field": "status", "to": "BLOCKED"}),
                _n("wait", "action", 0, 150, {"kind": "WAIT", "minutes": 2880}),
                _n("still", "condition", 0, 300, {"tree": _tree("status", ("BLOCKED",))}),
                _n("remind", "action", 0, 450, {"kind": "NOTIFY", **OWNER,
                                                "title": "{record} has been blocked for two days"}),
            ],
            "edges": [_e("trigger", "wait"), _e("wait", "still"), _e("still", "remind")],
        },
    },
    {
        "name": "Approve large orders before fulfilment",
        "description": "Orders over the threshold wait for a manager; approved ones get a fulfilment task.",
        "severity": "WARNING",
        "graph": {
            "nodes": [
                _n("trigger", "trigger", 0, 0, {"event": "RECORD_CREATED", "resource_type": "order"}),
                _n("ask", "action", 0, 150, {"kind": "APPROVAL", "title": "Approve order {record}"}),
                _n("ship", "action", -170, 300, {"kind": "TASK", "title": "Fulfil {record}", "priority": "HIGH"}),
                _n("tell", "action", 170, 300, {"kind": "NOTIFY", **OWNER,
                                                "title": "Order {record} was not approved"}),
            ],
            "edges": [_e("trigger", "ask"), _e("ask", "ship", "approved"), _e("ask", "tell", "rejected")],
        },
    },
    {
        "name": "Escalate overdue critical tasks every morning",
        "description": "Weekdays at 08:00: critical tasks still open are raised with the managers.",
        "severity": "CRITICAL",
        "graph": {
            "nodes": [
                _n("trigger", "trigger", 0, 0, {"event": "SCHEDULE", "resource_type": "task",
                                                "schedule": "0 8 * * 1-5"}),
                _n("open", "condition", 0, 150, {"tree": _tree("priority", ("CRITICAL",))}),
                _n("started", "branch", 0, 300, {"tree": _tree("status", ("IN_PROGRESS", "IN_REVIEW"))}),
                _n("nudge", "action", -170, 450, {"kind": "NOTIFY", **OWNER,
                                                  "title": "{record} is critical and still in flight"}),
                _n("escalate", "action", 170, 450, {"kind": "NOTIFY", "recipients": {"role": "MANAGER"},
                                                    "title": "Nobody has started critical {record}"}),
            ],
            "edges": [_e("trigger", "open"), _e("open", "started"), _e("started", "nudge", "true"),
                      _e("started", "escalate", "false")],
        },
    },
    {
        "name": "Open a ticket from the monitoring webhook",
        "description": "The monitoring system posts a device id; a ticket is opened against it.",
        "severity": "INFO",
        "graph": {
            "nodes": [
                _n("trigger", "trigger", 0, 0, {"event": "WEBHOOK", "resource_type": "device"}),
                _n("ticket", "action", 0, 150, {"kind": "CREATE_RECORD", "resource_type": "task",
                                                "values": {"title": "Investigate alert on {record}",
                                                           "priority": "HIGH"}}),
                _n("tell", "action", 0, 300, {"kind": "NOTIFY", **OWNER, "title": "Monitoring flagged {record}"}),
            ],
            "edges": [_e("trigger", "ticket"), _e("ticket", "tell")],
        },
    },
)
