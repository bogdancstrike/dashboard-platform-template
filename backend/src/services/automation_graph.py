"""Automations as node graphs: the canvas's model, its validation, and the engine (§49).

The form editor wrote one sentence — *when records look like this, do these
things*. The canvas writes a small program: a trigger, conditions, if/else
branches, actions, delays and approvals, joined by edges. This module is that
program's one definition, and the one engine that runs it.

Five decisions carry the design.

**One stored definition, two editors.** The graph is what is stored and what
runs. The form editor reads and writes its straight-line case — trigger,
condition, actions in order — and `derive_legacy` projects every published
graph back onto the `alert_rules` columns, so the list, its filters and the
wizard keep working without knowing graphs exist. A graph that branches is
refused by the form editor rather than flattened: flattening would silently
throw away the branch somebody drew.

**The engine walks sets, not records.** A condition node is one `SELECT … WHERE
id IN (…) AND <predicate>` over every record that reached it, compiled by
`core/rules` exactly as the advanced search compiles it. So a scheduled run over
five hundred records is a handful of queries, and the condition a reader sees
on a node is provably the SQL that decided the path.

**A dry run is the same walk with the actions switched off** — the reason the
form editor's dry run was trustworthy, kept. The test run on the canvas is that
walk for one chosen record, reporting the path it took through every node.

**Draft and published are separate.** The canvas saves on every change; nothing
runs until somebody publishes, and every publish is kept whole as a version
that can be restored. A half-drawn workflow must never fire.

**Waiting is a row, not a sleeping thread.** A delay or an approval parks the
record in `automation_waits` with the version it was walking; the scheduler or
the approval decision resumes it from the right port of the right version.
"""

from __future__ import annotations

import contextvars
import re
import secrets
from copy import deepcopy
from dataclasses import dataclass, field as dataclass_field
from datetime import datetime, timedelta
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import select

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.core.rules import compile_tree, describe_tree, rule_count
from src.models.automation_graphs import AutomationGraph, AutomationVersion, AutomationWait
from src.models.platform import AlertRule, AlertRuleRun

PERMISSION = "automations.manage"

#: A graph bigger than this is a program that wants to be code.
MAX_NODES = 60
MAX_EDGES = 120

#: How long a delay node may hold a record: thirty days.
MAX_WAIT_MINUTES = 60 * 24 * 30

#: Runs read for the per-node counts the canvas overlays.
STATS_RUNS = 50

_NODE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

TRIGGERS: dict[str, dict[str, Any]] = {
    "RECORD_CREATED": {
        "label": "Record created",
        "description": "Runs once for every new record in the dataset.",
    },
    "RECORD_UPDATED": {
        "label": "Record updated",
        "description": "Runs whenever a record in the dataset is edited.",
    },
    "FIELD_CHANGED": {
        "label": "Field changed",
        "description": "Runs when one field changes — optionally only to one value.",
        "needs": ["field"],
    },
    "SCHEDULE": {
        "label": "On a schedule",
        "description": "Runs on a cron schedule over the records its first condition selects.",
        "needs": ["schedule"],
    },
    "WEBHOOK": {
        "label": "Webhook called",
        "description": "Runs when another system POSTs a record id to the workflow's own address.",
    },
    "FORM_SUBMITTED": {
        "label": "Form submitted",
        "description": "Runs when an intake form creates a record in the dataset.",
    },
}

#: Actions that change where the walk goes rather than doing something to the
#: record. Executed by the engine itself; the rest are `workflows.ACTIONS`.
FLOW: dict[str, dict[str, Any]] = {
    "WAIT": {
        "label": "Wait",
        "description": "Pause this record for a while, then carry on.",
        "needs": ["minutes"],
        "ports": ["out"],
    },
    "APPROVAL": {
        "label": "Request approval",
        "description": "Ask somebody to approve; carry on down Approved or Rejected.",
        "needs": [],
        "ports": ["approved", "rejected"],
    },
}

PORTS = {
    "trigger": ("out",),
    "condition": ("out",),
    "branch": ("true", "false"),
}

#: Set while an automation's own actions write records, so a workflow that
#: updates a task does not trigger itself (or another workflow) in a loop.
_ACTIVE: contextvars.ContextVar[bool] = contextvars.ContextVar("automation_active", default=False)


# ── The graph's shape ────────────────────────────────────────────────────


def _ports_for(node: dict[str, Any]) -> tuple[str, ...]:
    kind = node.get("type")
    if kind == "action":
        flow = FLOW.get(str((node.get("data") or {}).get("kind") or "").upper())
        return tuple(flow["ports"]) if flow else ("out",)
    return PORTS.get(str(kind), ())


def normalize(raw: Any) -> dict[str, Any]:
    """The graph a client sent, checked for *shape* only.

    Shape errors (not an object, a node without an id, an edge to nowhere) are
    refused outright: nothing sensible can be stored. *Meaning* errors — a
    condition with no rules, an action that reaches nobody — are kept and
    reported per node by `problems`, because a draft is allowed to be
    unfinished and the canvas has to be able to say where.
    """
    if not isinstance(raw, dict):
        raise ValidationError("A workflow graph must be an object with nodes and edges.")
    nodes_in = raw.get("nodes")
    edges_in = raw.get("edges") or []
    if not isinstance(nodes_in, list) or not isinstance(edges_in, list):
        raise ValidationError("A workflow graph needs a list of nodes and a list of edges.")
    if len(nodes_in) > MAX_NODES:
        raise ValidationError(f"A workflow may have at most {MAX_NODES} nodes.")
    if len(edges_in) > MAX_EDGES:
        raise ValidationError(f"A workflow may have at most {MAX_EDGES} connections.")

    nodes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in nodes_in:
        if not isinstance(item, dict):
            raise ValidationError("Each node must be an object.")
        node_id = str(item.get("id") or "")
        if not _NODE_ID.match(node_id):
            raise ValidationError("Each node needs an id of letters, digits, - or _.",
                                  details={"id": node_id})
        if node_id in seen:
            raise ValidationError("Two nodes share an id.", details={"id": node_id})
        seen.add(node_id)
        kind = str(item.get("type") or "")
        if kind not in ("trigger", "condition", "branch", "action"):
            raise ValidationError(f"{kind or '(none)'} is not a kind of node.",
                                  details={"id": node_id})
        position = item.get("position") if isinstance(item.get("position"), dict) else {}
        data = item.get("data") if isinstance(item.get("data"), dict) else {}
        nodes.append(
            {
                "id": node_id,
                "type": kind,
                "position": {"x": _number(position.get("x")), "y": _number(position.get("y"))},
                "data": deepcopy(data),
            }
        )

    edges: list[dict[str, Any]] = []
    edge_ids: set[str] = set()
    for index, item in enumerate(edges_in):
        if not isinstance(item, dict):
            raise ValidationError("Each connection must be an object.")
        source = str(item.get("source") or "")
        target = str(item.get("target") or "")
        if source not in seen or target not in seen:
            raise ValidationError("A connection joins a node that is not in the graph.",
                                  details={"source": source, "target": target})
        port = str(item.get("port") or item.get("sourceHandle") or "out")
        edge_id = str(item.get("id") or f"e{index}-{source}-{port}-{target}")[:120]
        if edge_id in edge_ids:
            edge_id = f"{edge_id}-{index}"
        edge_ids.add(edge_id)
        edges.append({"id": edge_id, "source": source, "port": port, "target": target})

    return {"nodes": nodes, "edges": edges}


def _number(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if number != number or abs(number) > 1e6:  # NaN, or off any sane canvas
        return 0.0
    return round(number, 1)


def trigger_of(graph: dict[str, Any] | None) -> dict[str, Any] | None:
    for node in (graph or {}).get("nodes") or []:
        if node.get("type") == "trigger":
            return node
    return None


def _by_id(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {node["id"]: node for node in graph.get("nodes") or []}


def _outgoing(graph: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for edge in graph.get("edges") or []:
        out.setdefault(edge["source"], []).append(edge)
    return out


def _resource(key: Any):
    from src.services.explorer import resources

    return resources().get(str(key or ""))


# ── Validation ───────────────────────────────────────────────────────────


def problems(session, graph: dict[str, Any]) -> list[dict[str, str]]:
    """Everything that stops this graph from being published, per node.

    `node_id` is "" for a problem with the whole graph. Returned rather than
    raised so the canvas can paint every one of them at once.
    """
    found: list[dict[str, str]] = []

    def say(node_id: str, message: str) -> None:
        found.append({"node_id": node_id, "message": message})

    nodes = graph.get("nodes") or []
    triggers = [node for node in nodes if node["type"] == "trigger"]
    if not triggers:
        say("", "A workflow starts with a trigger.")
        return found
    if len(triggers) > 1:
        for node in triggers[1:]:
            say(node["id"], "A workflow has exactly one trigger.")
    trigger = triggers[0]
    by_id = _by_id(graph)
    outgoing = _outgoing(graph)

    resource = _resource((trigger.get("data") or {}).get("resource_type"))
    _check_trigger(session, trigger, resource, outgoing, by_id, say)

    for edge in graph.get("edges") or []:
        source = by_id[edge["source"]]
        if edge["port"] not in _ports_for(source):
            say(source["id"], f"This node has no {edge['port']!r} output.")
        if edge["source"] == edge["target"]:
            say(source["id"], "A node cannot connect to itself.")
        if by_id[edge["target"]]["type"] == "trigger":
            say(source["id"], "Nothing can lead back into the trigger.")

    cycle = _cycle(graph)
    if cycle:
        say(cycle, "This connection makes a loop; a workflow must always move forward.")

    reachable = _reachable(graph, trigger["id"])
    for node in nodes:
        if node["id"] not in reachable:
            say(node["id"], "Not connected to the trigger, so it would never run.")

    actions = 0
    for node in nodes:
        data = node.get("data") or {}
        if node["type"] in ("condition", "branch"):
            _check_tree(data.get("tree"), resource, node["id"], say)
            if node["type"] == "branch" and not outgoing.get(node["id"]):
                say(node["id"], "Connect the Yes or No output — a branch that leads nowhere does nothing.")
        elif node["type"] == "action":
            if node["id"] in reachable:
                actions += 1
            try:
                clean_action(session, data, resource)
            except ValidationError as error:
                say(node["id"], error.message)
    if actions == 0:
        say("", "Add at least one action — a workflow that does nothing cannot be published.")
    return found


def _check_trigger(session, trigger, resource, outgoing, by_id, say) -> None:
    data = trigger.get("data") or {}
    event = str(data.get("event") or "").upper()
    if event not in TRIGGERS:
        say(trigger["id"], "Choose what starts this workflow.")
    if resource is None:
        say(trigger["id"], "Choose the dataset this workflow watches.")
        return
    if not outgoing.get(trigger["id"]):
        say(trigger["id"], "Connect the trigger to the first step.")
    if event == "FIELD_CHANGED" and str(data.get("field") or "") not in resource.fields.by_name:
        say(trigger["id"], "Choose which field's change starts this workflow.")
    if event == "SCHEDULE":
        try:
            _cron(str(data.get("schedule") or ""))
        except ValidationError as error:
            say(trigger["id"], error.message)
        first = [by_id[edge["target"]] for edge in outgoing.get(trigger["id"], [])]
        if len(first) != 1 or first[0]["type"] != "condition":
            say(trigger["id"], "A scheduled workflow starts with one condition: it says which records each run looks at.")
    if event == "FORM_SUBMITTED" and data.get("form"):
        from src.models.forms import IntakeForm

        if session.scalar(select(IntakeForm.id).where(IntakeForm.slug == str(data["form"]))) is None:
            say(trigger["id"], "That form does not exist.")


def _check_tree(tree: Any, resource, node_id: str, say) -> None:
    if not isinstance(tree, dict) or rule_count(tree) == 0:
        say(node_id, "Add at least one rule to this condition.")
        return
    if resource is None:
        return
    try:
        if compile_tree(tree, resource.fields) is None:
            say(node_id, "Finish the rules in this condition — each needs a value.")
    except ValidationError as error:
        say(node_id, error.message)


def _reachable(graph: dict[str, Any], start: str) -> set[str]:
    outgoing = _outgoing(graph)
    seen = {start}
    stack = [start]
    while stack:
        for edge in outgoing.get(stack.pop(), []):
            if edge["target"] not in seen:
                seen.add(edge["target"])
                stack.append(edge["target"])
    return seen


def _cycle(graph: dict[str, Any]) -> str | None:
    """The id of a node on a loop, or None. Iterative three-colour DFS."""
    outgoing = _outgoing(graph)
    state: dict[str, int] = {}
    for root in _by_id(graph):
        if state.get(root):
            continue
        stack: list[tuple[str, int]] = [(root, 0)]
        state[root] = 1
        while stack:
            node, index = stack[-1]
            edges = outgoing.get(node, [])
            if index < len(edges):
                stack[-1] = (node, index + 1)
                target = edges[index]["target"]
                if state.get(target) == 1:
                    return node
                if not state.get(target):
                    state[target] = 1
                    stack.append((target, 0))
            else:
                state[node] = 2
                stack.pop()
    return None


def clean_action(session, data: dict[str, Any], resource) -> dict[str, Any]:
    """One action's configuration, checked against what its kind needs.

    Shared by the canvas and the form editor, so the two cannot accept
    different things under the same name.
    """
    from src.services import workflows

    kind = str(data.get("kind") or data.get("type") or "").strip().upper()
    if kind in FLOW:
        return _clean_flow(kind, data)
    if kind not in workflows.ACTIONS:
        raise ValidationError(
            f"{kind or '(none)'} is not an action this platform can run.",
            details={"allowed": sorted([*workflows.ACTIONS, *FLOW])},
        )
    config: dict[str, Any] = {"kind": kind}
    action = workflows.ACTIONS[kind]
    if "recipients" in action.needs:
        config["recipients"] = workflows._recipient_config(data)
    if "url" in action.needs:
        config["url"] = workflows._webhook_url(data.get("url"))
    for name in ("title", "body", "subject", "template", "priority", "label"):
        if data.get(name):
            config[name] = str(data[name])[:2000]
    if data.get("assignee_id"):
        config["assignee_id"] = str(parse_uuid(data["assignee_id"], field="assignee_id"))
    if config.get("template"):
        from src.models.content import EmailTemplate

        code = config["template"]
        if session.scalar(select(EmailTemplate.id).where(EmailTemplate.code == code)) is None:
            raise ValidationError(f"No email template is called {code!r}.")

    if kind == "UPDATE_FIELD":
        _clean_update(session, data, resource, config)
    elif kind == "ASSIGN":
        if resource is not None and assignable_field(resource) is None:
            raise ValidationError(f"{resource.label} have nobody to assign.")
        if not config.get("assignee_id") and not data.get("to_owner"):
            raise ValidationError("Choose who to assign it to.")
        config["to_owner"] = bool(data.get("to_owner")) and not config.get("assignee_id")
    elif kind == "CREATE_RECORD":
        _clean_create(session, data, config)
    return config


def _clean_flow(kind: str, data: dict[str, Any]) -> dict[str, Any]:
    if kind == "WAIT":
        try:
            minutes = int(data.get("minutes"))
        except (TypeError, ValueError) as error:
            raise ValidationError("Say how many minutes to wait.") from error
        if not 1 <= minutes <= MAX_WAIT_MINUTES:
            raise ValidationError("A wait runs from one minute to thirty days.")
        return {"kind": kind, "minutes": minutes}
    config: dict[str, Any] = {"kind": kind}
    if data.get("title"):
        config["title"] = str(data["title"])[:240]
    if data.get("body"):
        config["body"] = str(data["body"])[:2000]
    if data.get("assignee_id"):
        config["assignee_id"] = str(parse_uuid(data["assignee_id"], field="assignee_id"))
    return config


def _clean_update(session, data: dict[str, Any], resource, config: dict[str, Any]) -> None:
    from src.services import record_writes

    name = str(data.get("field") or "")
    if resource is None:
        raise ValidationError("Choose the dataset first.")
    if name not in resource.writable:
        raise ValidationError("Choose a field this workflow may set.",
                              details={"editable": sorted(resource.writable)})
    if "value" not in data or data.get("value") in (None, ""):
        raise ValidationError("Say what to set it to.")
    value = data["value"]
    if not (isinstance(value, str) and "{" in value):
        _, issues = record_writes.coerce(session, resource, {name: value}, creating=False)
        if issues:
            raise ValidationError(issues[0]["message"])
    config.update({"field": name, "value": value})


def _clean_create(session, data: dict[str, Any], config: dict[str, Any]) -> None:
    from src.services import record_writes

    target = _resource(data.get("resource_type"))
    if target is None or target.identity is None:
        raise ValidationError("Choose a dataset records can be created in.")
    values = data.get("values") if isinstance(data.get("values"), dict) else {}
    literal = {k: v for k, v in values.items() if not (isinstance(v, str) and "{" in v)}
    _, issues = record_writes.coerce(session, target, {**{k: "x" for k in values if k not in literal}, **literal}, creating=True)
    # A templated value is checked for its *name* only; its text is filled
    # in when the workflow runs.
    issues = [item for item in issues if item["field"] not in values or item["field"] in literal]
    if issues:
        raise ValidationError(issues[0]["message"])
    config.update({"resource_type": target.key, "values": dict(values)})


def assignable_field(resource) -> str | None:
    for name in ("assignee_id", "owner_id", "manager_id", "account_manager_id"):
        if name in resource.writable:
            return name
    return None


# ── Cron ─────────────────────────────────────────────────────────────────


def _cron(value: str) -> str:
    from src.services import workflows

    text = workflows._cron(value)
    for part, (low, high) in zip(text.split(" "), _CRON_RANGES):
        _cron_values(part, low, high)
    return text


_CRON_RANGES = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 7))


def _cron_values(part: str, low: int, high: int) -> set[int]:
    values: set[int] = set()
    for piece in part.split(","):
        step = 1
        if "/" in piece:
            piece, raw_step = piece.split("/", 1)
            step = _cron_int(raw_step, 1, high or 1)
        if piece in ("*", ""):
            start, end = low, high
        elif "-" in piece:
            first, last = piece.split("-", 1)
            start, end = _cron_int(first, low, high), _cron_int(last, low, high)
        else:
            start = end = _cron_int(piece, low, high)
            if step != 1:
                end = high
        if start > end:
            raise ValidationError(f"{part!r} runs backwards in the schedule.")
        values.update(range(start, end + 1, step))
    return values


def _cron_int(raw: str, low: int, high: int) -> int:
    try:
        number = int(raw)
    except ValueError as error:
        raise ValidationError(f"{raw!r} is not a number in the schedule.") from error
    if not low <= number <= high:
        raise ValidationError(f"{number} is outside {low}–{high} in the schedule.")
    return number


def cron_matches(expression: str, moment: datetime) -> bool:
    minute, hour, day, month, weekday = expression.split(" ")
    weekdays = {value % 7 for value in _cron_values(weekday, 0, 7)}
    day_ok = moment.day in _cron_values(day, 1, 31)
    weekday_ok = (moment.isoweekday() % 7) in weekdays
    # Cron's own rule: when both day fields are restricted, either may match.
    if day != "*" and weekday != "*":
        calendar_ok = day_ok or weekday_ok
    else:
        calendar_ok = day_ok and weekday_ok
    return (
        moment.minute in _cron_values(minute, 0, 59)
        and moment.hour in _cron_values(hour, 0, 23)
        and moment.month in _cron_values(month, 1, 12)
        and calendar_ok
    )


def cron_due(expression: str, since: datetime | None, until: datetime) -> bool:
    """Whether the schedule fired in (since, until] — looking back a day at most."""
    end = until.replace(second=0, microsecond=0)
    start = max(since or end - timedelta(minutes=1), end - timedelta(days=1))
    moment = start.replace(second=0, microsecond=0) + timedelta(minutes=1)
    while moment <= end:
        if cron_matches(expression, moment):
            return True
        moment += timedelta(minutes=1)
    return False


# ── Legacy ↔ graph ───────────────────────────────────────────────────────

#: Vertical spacing of a converted rule, matching the canvas's auto-layout.
_ROW = 150


def from_legacy(rule: AlertRule) -> dict[str, Any]:
    """The graph a form-built rule has always meant: schedule → condition → actions."""
    nodes: list[dict[str, Any]] = [
        {
            "id": "trigger",
            "type": "trigger",
            "position": {"x": 0, "y": 0},
            "data": {"event": "SCHEDULE", "resource_type": rule.resource_type,
                     "schedule": rule.schedule or "*/15 * * * *"},
        },
        {
            "id": "condition",
            "type": "condition",
            "position": {"x": 0, "y": _ROW},
            "data": {"tree": rule.condition_tree},
        },
    ]
    edges = [{"id": "e-trigger-condition", "source": "trigger", "port": "out", "target": "condition"}]
    previous = "condition"
    for index, action in enumerate(a for a in (rule.actions or []) if isinstance(a, dict)):
        node_id = f"action{index + 1}"
        nodes.append({"id": node_id, "type": "action",
                      "position": {"x": 0, "y": _ROW * (index + 2)}, "data": dict(action)})
        edges.append({"id": f"e-{previous}-{node_id}", "source": previous, "port": "out", "target": node_id})
        previous = node_id
    return {"nodes": nodes, "edges": edges}


def linear(graph: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None, list[dict[str, Any]]] | None:
    """(trigger, condition, actions) when the graph is one straight line, else None.

    The straight line is what the form editor can show and edit: one trigger,
    at most one condition straight after it, then actions one after another,
    none of them a delay or an approval.
    """
    by_id = _by_id(graph)
    outgoing = _outgoing(graph)
    trigger = trigger_of(graph)
    if trigger is None:
        return None
    incoming: dict[str, int] = {}
    for edge in graph.get("edges") or []:
        incoming[edge["target"]] = incoming.get(edge["target"], 0) + 1
    chain: list[dict[str, Any]] = []
    current = trigger
    seen = {trigger["id"]}
    while True:
        edges = outgoing.get(current["id"], [])
        if not edges:
            break
        if len(edges) != 1:
            return None
        current = by_id[edges[0]["target"]]
        if current["id"] in seen or incoming.get(current["id"], 0) != 1:
            return None
        seen.add(current["id"])
        chain.append(current)
    if len(seen) != len(by_id):
        return None
    condition = None
    if chain and chain[0]["type"] == "condition":
        condition = chain.pop(0)
    for node in chain:
        kind = str((node.get("data") or {}).get("kind") or "").upper()
        if node["type"] != "action" or kind in FLOW:
            return None
    return trigger, condition, chain


def apply_form_edit(graph: dict[str, Any] | None, rule: AlertRule) -> dict[str, Any]:
    """Rebuild a straight-line graph from the rule's (just edited) columns.

    Keeps the trigger as it was — the form editor never changed what starts a
    workflow — and reuses node ids and positions where a node is still there, so
    the canvas does not jump about after somebody edits in the form.
    """
    fresh = from_legacy(rule)
    if graph is None:
        return fresh
    parts = linear(graph)
    if parts is None:
        raise ValidationError(
            "This workflow branches, waits or asks for approval, so the form cannot show all of it. "
            "Edit it on the canvas.",
        )
    trigger, condition, actions = parts
    trigger = deepcopy(trigger)
    trigger["data"]["resource_type"] = rule.resource_type
    if str(trigger["data"].get("event")) == "SCHEDULE":
        trigger["data"]["schedule"] = rule.schedule
    nodes = [trigger]
    edges: list[dict[str, Any]] = []
    previous = trigger
    old = ([condition] if condition else []) + actions
    new = [node for node in fresh["nodes"] if node["type"] != "trigger"]
    if condition is None and not (rule.condition_tree and rule_count(rule.condition_tree)):
        new = [node for node in new if node["type"] != "condition"]
    for index, node in enumerate(new):
        if index < len(old) and old[index]["type"] == node["type"]:
            node = {**node, "id": old[index]["id"], "position": old[index]["position"]}
        nodes.append(node)
        edges.append({"id": f"e-{previous['id']}-{node['id']}", "source": previous["id"],
                      "port": "out", "target": node["id"]})
        previous = node
    return {"nodes": nodes, "edges": edges}


def derive_legacy(session, graph: dict[str, Any]) -> dict[str, Any]:
    """The `alert_rules` columns a published graph implies, for lists and filters."""
    from src.services import workflows

    trigger = trigger_of(graph) or {"data": {}}
    data = trigger.get("data") or {}
    resource = _resource(data.get("resource_type"))
    values: dict[str, Any] = {"resource_type": resource.key if resource else str(data.get("resource_type"))}
    if str(data.get("event")) == "SCHEDULE" and data.get("schedule"):
        values["schedule"] = _cron(str(data["schedule"]))
    first = next(
        (node for node in graph.get("nodes") or [] if node["type"] in ("condition", "branch")), None
    )
    tree = (first.get("data") or {}).get("tree") if first else None
    values["condition_tree"] = tree
    values["condition_text"] = (describe_tree(tree, resource.fields) or None) if (tree and resource) else None
    actions = []
    for node in graph.get("nodes") or []:
        if node["type"] == "action":
            kind = str((node.get("data") or {}).get("kind") or "").upper()
            if kind in workflows.ACTIONS:
                actions.append(clean_action(session, node["data"], resource))
    values["actions"] = actions
    return values


def describe_trigger(graph: dict[str, Any] | None) -> dict[str, Any] | None:
    """One line saying what starts a workflow, for the list."""
    trigger = trigger_of(graph)
    if trigger is None:
        return None
    data = trigger.get("data") or {}
    event = str(data.get("event") or "").upper()
    meta = TRIGGERS.get(event, {"label": event})
    text = meta["label"]
    if event == "FIELD_CHANGED" and data.get("field"):
        text = f"{data['field']} changes" + (f" to {data['to']}" if data.get("to") else "")
    elif event == "SCHEDULE":
        text = f"Schedule {data.get('schedule') or ''}".strip()
    elif event == "FORM_SUBMITTED" and data.get("form"):
        text = f"Form {data['form']} submitted"
    return {"event": event, "label": meta["label"], "text": text}


# ── The engine ───────────────────────────────────────────────────────────


@dataclass
class Walk:
    """One evaluation in progress: what reached where, and what happened."""

    rule: AlertRule
    graph: dict[str, Any]
    resource: Any
    dry_run: bool
    version: int
    run: AlertRuleRun | None = None
    counts: dict[str, dict[str, int]] = dataclass_field(default_factory=dict)
    #: record id → {"record", "record_id", "path", "actions", "states"}
    records: dict[str, dict[str, Any]] = dataclass_field(default_factory=dict)
    edges_taken: dict[str, int] = dataclass_field(default_factory=dict)
    parked: int = 0

    def count(self, node_id: str, key: str, amount: int = 1) -> None:
        if not amount:
            return
        bucket = self.counts.setdefault(node_id, {})
        bucket[key] = bucket.get(key, 0) + amount

    def visit(self, node_id: str, match, state: str, detail: str = "") -> None:
        entry = self.records.setdefault(
            match.id,
            {"record": match.label, "record_id": match.id, "path": match.path,
             "nodes": [], "actions": []},
        )
        entry["nodes"].append({"node_id": node_id, "state": state, "detail": detail})


def _matches_for(resource, rows: Iterable[Any]):
    from src.services.workflows import Match

    return [
        Match(id=str(row.id), label=resource.label_for(row), path=f"{resource.path}/{row.id}", row=row)
        for row in rows
    ]


def _filter(session, resource, tree: Any, matches: list) -> list:
    """The matches a condition keeps, decided in PostgreSQL."""
    if not matches:
        return []
    predicate = compile_tree(tree, resource.fields) if isinstance(tree, dict) else None
    if predicate is None:
        return []
    ids = [UUID(match.id) for match in matches]
    statement = select(resource.model.id).where(resource.model.id.in_(ids), predicate)
    kept = {str(value) for value in session.scalars(statement).unique().all()}
    return [match for match in matches if match.id in kept]


def _walk(session, walk: Walk, starts: list[tuple[str, list]]) -> None:
    """Breadth-first over the graph, carrying the set of records at each node."""
    from src.services import workflows

    by_id = _by_id(walk.graph)
    outgoing = _outgoing(walk.graph)
    queue: list[tuple[str, list]] = [item for item in starts if item[1]]
    steps = 0
    while queue:
        steps += 1
        if steps > MAX_NODES * 4:  # unreachable for a validated DAG; a backstop
            break
        node_id, matches = queue.pop(0)
        node = by_id.get(node_id)
        if node is None or not matches:
            continue
        walk.count(node_id, "in", len(matches))
        data = node.get("data") or {}
        exits: dict[str, list] = {}

        if node["type"] == "trigger":
            for match in matches:
                walk.visit(node_id, match, "started")
            exits["out"] = matches
        elif node["type"] in ("condition", "branch"):
            kept = _filter(session, walk.resource, data.get("tree"), matches)
            kept_ids = {match.id for match in kept}
            dropped = [match for match in matches if match.id not in kept_ids]
            for match in matches:
                passed = match.id in kept_ids
                if node["type"] == "branch":
                    walk.visit(node_id, match, "yes" if passed else "no")
                else:
                    walk.visit(node_id, match, "passed" if passed else "stopped")
            if node["type"] == "branch":
                exits["true"], exits["false"] = kept, dropped
                walk.count(node_id, "true", len(kept))
                walk.count(node_id, "false", len(dropped))
            else:
                exits["out"] = kept
                walk.count(node_id, "out", len(kept))
                walk.count(node_id, "stopped", len(dropped))
        else:
            kind = str(data.get("kind") or "").upper()
            if kind in FLOW:
                exits = _flow(session, walk, node, kind, data, matches)
            else:
                for match in matches:
                    ok, detail = _run_action(session, walk, kind, data, match, workflows)
                    walk.count(node_id, "ok" if ok else "failed")
                    walk.visit(node_id, match, "done" if ok else "failed", detail)
                    walk.records[match.id]["actions"].append(
                        {"kind": kind, "ok": ok, "detail": detail, "node_id": node_id}
                    )
                exits["out"] = matches

        for edge in outgoing.get(node_id, []):
            forward = exits.get(edge["port"]) or []
            if forward:
                walk.edges_taken[edge["id"]] = walk.edges_taken.get(edge["id"], 0) + len(forward)
                queue.append((edge["target"], forward))


def _run_action(session, walk: Walk, kind: str, data: dict[str, Any], match, workflows) -> tuple[bool, str]:
    if walk.dry_run:
        return True, f"would {workflows.ACTIONS[kind].label.lower()}" if kind in workflows.ACTIONS else "would run"
    action = workflows.ACTIONS.get(kind)
    if action is None:
        return False, "no such action"
    savepoint = session.begin_nested()
    token = _ACTIVE.set(True)
    try:
        detail = action.run(session, rule=walk.rule, match=match, config=data)
        savepoint.commit()
        return True, detail
    except Exception as error:  # noqa: BLE001 - recorded, never raised
        savepoint.rollback()
        return False, workflows._reason(error)
    finally:
        _ACTIVE.reset(token)


def _flow(session, walk: Walk, node, kind: str, data: dict[str, Any], matches: list) -> dict[str, list]:
    """A delay or an approval: in a dry run, the path it would take; for real, a park."""
    if walk.dry_run:
        for match in matches:
            detail = (f"would wait {data.get('minutes')} min" if kind == "WAIT"
                      else "would ask for approval")
            walk.visit(node["id"], match, "waiting", detail)
            walk.count(node["id"], "ok")
        # The rehearsal follows the hopeful path, so the reader sees the rest.
        return {"out": matches} if kind == "WAIT" else {"approved": matches}

    for match in matches:
        wait = AutomationWait(
            rule_id=walk.rule.id,
            run_id=walk.run.id if walk.run is not None else None,
            version=walk.version,
            node_id=node["id"],
            resource_type=walk.resource.key,
            record_id=match.id,
            record_label=match.label[:240],
            kind="DELAY" if kind == "WAIT" else "APPROVAL",
            status="PENDING",
        )
        if kind == "WAIT":
            minutes = int(data.get("minutes") or 1)
            wait.due_at = now() + timedelta(minutes=minutes)
            detail = f"waiting until {iso(wait.due_at)}"
        else:
            detail = _ask(session, walk, data, match, wait)
        session.add(wait)
        walk.parked += 1
        walk.count(node["id"], "waiting")
        walk.visit(node["id"], match, "waiting", detail)
        walk.records[match.id]["actions"].append(
            {"kind": kind, "ok": True, "detail": detail, "node_id": node["id"]}
        )
    session.flush()
    return {}


def _ask(session, walk: Walk, data: dict[str, Any], match, wait: AutomationWait) -> str:
    from src.services import approvals
    from src.services.workflows import _text

    register_provider()
    owner = walk.rule.owner
    row = approvals.submit(
        session,
        kind=APPROVAL_KIND,
        requester_id=walk.rule.owner_id,
        requester_label=owner.full_name if owner else walk.rule.name,
        title=_text(str(data.get("title") or "{rule}: approve {record}"), match, walk.rule),
        summary=_text(str(data.get("body") or ""), match, walk.rule),
        subject_type=walk.resource.key,
        subject_id=match.id,
        subject_label=match.label,
        link=match.path,
        payload={"rule_id": str(walk.rule.id), "rule": walk.rule.name},
        assignee_id=parse_uuid(data["assignee_id"], field="assignee_id") if data.get("assignee_id") else None,
    )
    wait.approval_id = str(row.id)
    return f"asked {row.reference}"


def evaluate(
    session,
    rule: AlertRule,
    *,
    principal,
    dry_run: bool,
    records: list[Any] | None = None,
    event: dict[str, Any] | None = None,
    graph_row: AutomationGraph | None = None,
) -> dict[str, Any]:
    """Run the published graph — over its population, or over given records.

    Without `records` this is a scheduled or "run now" evaluation: the records
    are the ones the condition straight after the trigger selects, through the
    same cooldown and fire budget the form-built rules always had. With
    `records` it is an event — a create, an edit, a webhook — and the records
    walk the whole graph, every condition included.
    """
    from src.services import workflows

    graph_row = graph_row or ensure(session, rule)
    graph = graph_row.published or from_legacy(rule)
    run = AlertRuleRun(
        rule_id=rule.id,
        dry_run=dry_run,
        triggered_by_id=getattr(principal, "user_id", None),
        started_at=now(),
    )
    session.add(run)
    session.flush()

    trigger = trigger_of(graph)
    resource = _resource(rule.resource_type)
    if trigger is None or resource is None:
        run.finished_at = now()
        run.error = "This workflow has no trigger." if trigger is None else (
            f"{rule.resource_type!r} is not a dataset any more.")
        session.flush()
        return workflows.serialize_run(run)

    capped = False
    try:
        if records is None:
            first = [
                _by_id(graph)[edge["target"]]
                for edge in _outgoing(graph).get(trigger["id"], [])
            ]
            tree = first[0]["data"].get("tree") if first and first[0]["type"] == "condition" else None
            matches, capped = workflows._matches(session, rule, principal=None, tree=tree)
        else:
            matches = _matches_for(resource, records)
    except ValidationError as error:
        run.finished_at = now()
        run.error = str(error)
        session.flush()
        return workflows.serialize_run(run)

    ledger = workflows._cooldown_ledger(session, rule, [match.id for match in matches])
    threshold = now() - timedelta(minutes=max(int(rule.cooldown_minutes or 0), 0))
    suppressed: list[dict[str, Any]] = []
    deferred = 0
    walking = []
    for match in matches:
        entry = ledger.get(match.id)
        if entry is not None and entry.last_fired_at and entry.last_fired_at > threshold:
            suppressed.append({"record": match.label, "record_id": match.id, "path": match.path,
                               "state": "SUPPRESSED", "since": iso(entry.last_fired_at), "actions": []})
            continue
        if len(walking) >= workflows.MAX_FIRES:
            deferred += 1
            continue
        walking.append(match)

    walk = Walk(rule=rule, graph=graph, resource=resource, dry_run=dry_run,
                version=graph_row.version, run=run)
    _walk(session, walk, [(trigger["id"], walking)])

    fired = 0
    outcomes: list[dict[str, Any]] = []
    for match in walking:
        entry = walk.records.get(match.id) or {"actions": [], "nodes": []}
        acted = bool(entry["actions"])
        if acted:
            fired += 1
            if not dry_run:
                workflows._remember(session, rule, match, ledger.get(match.id))
        state = ("WOULD FIRE" if dry_run else "FIRED") if acted else "SKIPPED"
        outcomes.append({
            "record": match.label, "record_id": match.id, "path": match.path, "state": state,
            "actions": [{"kind": a["kind"], "ok": a["ok"], "detail": a["detail"], "node_id": a["node_id"]}
                        for a in entry["actions"]],
            "nodes": entry["nodes"],
        })
    sample = (outcomes + suppressed)[: workflows.SAMPLE_SIZE]

    run.finished_at = now()
    run.matched = len(matches)
    run.fired = fired
    run.suppressed = len(suppressed)
    run.deferred = deferred
    run.detail = {
        "capped": capped,
        "sample": sample,
        "by_action": workflows._tally(outcomes),
        "nodes": walk.counts,
        "edges": walk.edges_taken,
        "parked": walk.parked,
        "version": graph_row.version,
        "trigger": event or {"event": "MANUAL" if principal is not None else "SCHEDULE"},
    }
    if not dry_run:
        rule.last_match_count = len(matches)
        if fired:
            rule.last_triggered_at = run.finished_at
            rule.trigger_count = int(rule.trigger_count or 0) + fired
    session.flush()
    return workflows.serialize_run(run)


def trace(session, rule_id: Any, payload: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    """The test run: one chosen record through the draft (or published) graph.

    A dry walk that writes nothing — no run row either, because a test on a
    draft is not something the rule *did*. Reports, per node, what happened to
    the record, and which connections it travelled.
    """
    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    graph_row = ensure(session, rule)
    body = payload if isinstance(payload, dict) else {}
    stored = graph_row.published if body.get("graph") == "published" else (graph_row.draft or graph_row.published)
    graph = normalize(stored) if stored else from_legacy(rule)
    trigger = trigger_of(graph)
    resource = _resource(((trigger or {}).get("data") or {}).get("resource_type"))
    if trigger is None or resource is None:
        raise ValidationError("Choose a trigger and its dataset before testing.")
    resource_for_principal(resource, principal)
    record_id = parse_uuid(body.get("record_id"), field="record_id")
    row = session.get(resource.model, record_id)
    if row is None or getattr(row, "deleted_at", None) is not None:
        raise NotFoundError("That record does not exist.")
    match = _matches_for(resource, [row])[0]
    walk = Walk(rule=rule, graph=graph, resource=resource, dry_run=True, version=graph_row.version)
    try:
        _walk(session, walk, [(trigger["id"], [match])])
    except ValidationError as error:
        return {"record": {"id": match.id, "label": match.label, "path": match.path},
                "nodes": [], "edges": [], "actions": [], "error": error.message}
    entry = walk.records.get(match.id) or {"nodes": [], "actions": []}
    return {
        "record": {"id": match.id, "label": match.label, "path": match.path},
        "nodes": entry["nodes"],
        "edges": sorted(walk.edges_taken),
        "actions": entry["actions"],
        "error": None,
    }


def resource_for_principal(resource, principal) -> None:
    if principal is not None:
        principal.require(resource.permission)


def samples(session, rule_id: Any, args, *, principal) -> dict[str, Any]:
    """Records to test with: the newest in the trigger's dataset, optionally searched."""
    from sqlalchemy import cast, or_, String as SqlString

    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    graph_row = ensure(session, rule)
    trigger = trigger_of(graph_row.draft or graph_row.published) or {}
    resource = _resource((trigger.get("data") or {}).get("resource_type") or rule.resource_type)
    if resource is None:
        return {"items": []}
    resource_for_principal(resource, principal)
    statement = select(resource.model)
    deleted = getattr(resource.model, "deleted_at", None)
    if deleted is not None:
        statement = statement.where(deleted.is_(None))
    text = str(args.get("q") or "").strip()
    if text:
        columns = [getattr(resource.model, name) for name in (resource.title_field, resource.subtitle_field, "reference")
                   if name and hasattr(resource.model, name)]
        if columns:
            statement = statement.where(or_(*[cast(column, SqlString).ilike(f"%{text}%") for column in columns]))
    order = getattr(resource.model, "updated_at", None)
    if order is not None:
        statement = statement.order_by(order.desc())
    rows = session.scalars(statement.limit(20)).unique().all()
    return {"items": [{"id": str(row.id), "label": resource.label_for(row),
                       "status": getattr(row, resource.status_field, None) if resource.status_field else None}
                      for row in rows]}


# ── Storage: draft, publish, versions ────────────────────────────────────


def ensure(session, rule: AlertRule) -> AutomationGraph:
    """The rule's graph row, created from its form-built columns when missing."""
    row = session.scalar(select(AutomationGraph).where(AutomationGraph.rule_id == rule.id))
    if row is None:
        graph = from_legacy(rule)
        row = AutomationGraph(rule_id=rule.id, draft=graph, published=graph, version=1,
                              published_at=rule.updated_at or now(), published_by_id=rule.owner_id)
        session.add(row)
        session.add(AutomationVersion(rule_id=rule.id, version=1, graph=graph,
                                      note="Converted from the form editor", published_by_id=rule.owner_id))
        session.flush()
    return row


def _rule(session, rule_id: Any) -> AlertRule:
    rule = session.get(AlertRule, parse_uuid(rule_id, field="rule_id"))
    if rule is None or rule.deleted_at is not None:
        raise NotFoundError("That automation does not exist.")
    return rule


def _require_own(rule: AlertRule, principal) -> None:
    from src.services import workflows

    workflows._require_own(rule, principal)


def detail(session, rule_id: Any, *, principal) -> dict[str, Any]:
    """Everything the canvas opens with."""
    from src.services import workflows

    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    row = ensure(session, rule)
    draft = row.draft or row.published
    versions = session.scalars(
        select(AutomationVersion).where(AutomationVersion.rule_id == rule.id)
        .order_by(AutomationVersion.version.desc()).limit(30)
    ).all()
    return {
        "rule": workflows._serialize(rule, principal, graph=row),
        "draft": draft,
        "published": row.published,
        "version": row.version,
        "published_at": iso(row.published_at),
        "published_by": row.published_by.full_name if row.published_by else None,
        "draft_updated_at": iso(row.draft_updated_at),
        "dirty": (row.draft or None) != (row.published or None) and row.draft is not None,
        "problems": problems(session, normalize(draft)) if draft else [],
        "versions": [
            {"version": item.version, "published_at": iso(item.created_at), "note": item.note,
             "by": item.published_by.full_name if item.published_by else None,
             "nodes": len((item.graph or {}).get("nodes") or [])}
            for item in versions
        ],
        "stats": node_stats(session, rule.id),
        "webhook_path": f"/public/automations/hooks/{row.webhook_token}" if row.webhook_token else None,
        "can_edit": workflows._can_edit(rule, principal),
    }


def save_draft(session, rule_id: Any, payload: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    """Keep what the canvas holds. `{"graph": null}` throws the draft away."""
    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    _require_own(rule, principal)
    row = ensure(session, rule)
    body = payload if isinstance(payload, dict) else {}
    if "graph" not in body:
        raise ValidationError("Send the graph to keep, or null to discard the draft.")
    row.draft = normalize(body["graph"]) if body["graph"] is not None else row.published
    row.draft_updated_at = now()
    row.draft_updated_by_id = getattr(principal, "user_id", None)
    session.flush()
    return detail(session, rule.id, principal=principal)


def publish(session, rule_id: Any, payload: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    """Make the draft the version that runs — refused, per node, if it cannot run."""
    from src.services import workflows

    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    _require_own(rule, principal)
    row = ensure(session, rule)
    graph = normalize(row.draft or row.published)
    found = problems(session, graph)
    if found:
        raise ValidationError(
            f"{len(found)} thing{'s' if len(found) != 1 else ''} to fix before this can be published.",
            details={"problems": found},
        )
    resource = _resource(trigger_of(graph)["data"].get("resource_type"))
    resource_for_principal(resource, principal)
    before = workflows._audit_state(rule)
    _install(session, rule, row, graph, principal=principal,
             note=str((payload or {}).get("note") or "").strip()[:500] or None)
    audit.record(
        session, action="automation.publish", resource_type="alert_rule", resource_id=rule.id,
        resource_label=rule.name, principal=principal, before=before,
        after={**workflows._audit_state(rule), "version": row.version},
        message=f"published version {row.version}",
    )
    return detail(session, rule.id, principal=principal)


def _install(session, rule: AlertRule, row: AutomationGraph, graph: dict[str, Any], *, principal,
             note: str | None) -> None:
    """Make `graph` the published version, and project it onto the rule."""
    for name, value in derive_legacy(session, graph).items():
        setattr(rule, name, value)
    trigger = trigger_of(graph)
    if trigger and trigger["data"].get("event") == "WEBHOOK" and not row.webhook_token:
        row.webhook_token = secrets.token_urlsafe(24)
    row.draft = graph
    row.published = graph
    row.version = int(row.version or 0) + 1
    row.published_at = now()
    row.published_by_id = getattr(principal, "user_id", None)
    session.add(AutomationVersion(rule_id=rule.id, version=row.version, graph=graph, note=note,
                                  published_by_id=row.published_by_id))
    session.flush()


def restore(session, rule_id: Any, payload: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    """Copy an earlier version into the draft. Publishing it is a separate act."""
    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    _require_own(rule, principal)
    row = ensure(session, rule)
    try:
        number = int((payload or {}).get("version"))
    except (TypeError, ValueError) as error:
        raise ValidationError("Say which version to restore.") from error
    version = session.scalar(select(AutomationVersion).where(
        AutomationVersion.rule_id == rule.id, AutomationVersion.version == number))
    if version is None:
        raise NotFoundError(f"There is no version {number}.")
    row.draft = deepcopy(version.graph)
    row.draft_updated_at = now()
    row.draft_updated_by_id = getattr(principal, "user_id", None)
    session.flush()
    return detail(session, rule.id, principal=principal)


def create_with_graph(session, rule: AlertRule, raw: Any, *, principal) -> AutomationGraph:
    """A rule written on the canvas: its first version is the graph it was made with."""
    graph = normalize(raw)
    found = problems(session, graph)
    if found:
        raise ValidationError(f"{found[0]['message']}", details={"problems": found})
    row = AutomationGraph(rule_id=rule.id, version=0)
    session.add(row)
    _install(session, rule, row, graph, principal=principal, note="Created on the canvas")
    return row


def after_form_edit(session, rule: AlertRule, *, principal) -> None:
    """The form editor changed the rule's columns: carry that into the graph."""
    row = ensure(session, rule)
    graph = apply_form_edit(row.published, rule)
    _install(session, rule, row, graph, principal=principal, note="Edited in the form")


def check_form_edit(session, rule: AlertRule) -> None:
    """Refuse a form edit of a graph the form cannot represent — before writing."""
    row = session.scalar(select(AutomationGraph).where(AutomationGraph.rule_id == rule.id))
    if row is not None and row.published and linear(row.published) is None:
        apply_form_edit(row.published, rule)  # raises with the reason


def node_stats(session, rule_id: Any) -> dict[str, Any]:
    """Per-node counts summed over recent real runs — the canvas's history overlay."""
    rows = session.scalars(
        select(AlertRuleRun).where(AlertRuleRun.rule_id == rule_id, AlertRuleRun.dry_run.is_(False))
        .order_by(AlertRuleRun.started_at.desc()).limit(STATS_RUNS)
    ).all()
    nodes: dict[str, dict[str, int]] = {}
    edges: dict[str, int] = {}
    for run in rows:
        detail_ = run.detail if isinstance(run.detail, dict) else {}
        for node_id, counts in (detail_.get("nodes") or {}).items():
            bucket = nodes.setdefault(node_id, {})
            for key, value in (counts or {}).items():
                bucket[key] = bucket.get(key, 0) + int(value or 0)
        for edge_id, value in (detail_.get("edges") or {}).items():
            edges[edge_id] = edges.get(edge_id, 0) + int(value or 0)
    return {"runs": len(rows), "nodes": nodes, "edges": edges}


# ── Events ───────────────────────────────────────────────────────────────


def on_record_write(session, resource, row, changed: set[str], *, created: bool, principal=None) -> int:
    """A record was written: run every published workflow whose trigger matches.

    Never lets a workflow break the write that triggered it — each runs in its
    own savepoint and a failure is recorded on the run, not raised. And never
    runs from inside an automation's own write, so workflows cannot loop.
    """
    if _ACTIVE.get():
        return 0
    try:
        candidates = session.execute(
            select(AlertRule, AutomationGraph)
            .join(AutomationGraph, AutomationGraph.rule_id == AlertRule.id)
            .where(AlertRule.enabled.is_(True), AlertRule.deleted_at.is_(None),
                   AlertRule.resource_type == resource.key)
        ).unique().all()
    except Exception:  # noqa: BLE001 - an automation must never fail a write
        return 0
    ran = 0
    username = str(getattr(principal, "username", "") or "")
    for rule, graph_row in candidates:
        trigger = trigger_of(graph_row.published)
        if trigger is None:
            continue
        data = trigger.get("data") or {}
        event = str(data.get("event") or "")
        if not _event_matches(event, data, row, changed, created=created, username=username):
            continue
        savepoint = session.begin_nested()
        token = _ACTIVE.set(True)
        try:
            evaluate(session, rule, principal=None, dry_run=False, records=[row],
                     event={"event": event, "record": resource.label_for(row)}, graph_row=graph_row)
            savepoint.commit()
            ran += 1
        except Exception:  # noqa: BLE001 - see the docstring
            savepoint.rollback()
        finally:
            _ACTIVE.reset(token)
    return ran


def _event_matches(event: str, data: dict[str, Any], row, changed: set[str], *, created: bool,
                   username: str) -> bool:
    if event == "RECORD_CREATED":
        return created
    if event == "RECORD_UPDATED":
        return not created and bool(changed)
    if event == "FIELD_CHANGED":
        name = str(data.get("field") or "")
        if created or name not in changed:
            return False
        wanted = data.get("to")
        return wanted in (None, "") or str(getattr(row, name, "")) == str(wanted)
    if event == "FORM_SUBMITTED":
        if not created or not username.startswith("form:"):
            return False
        return not data.get("form") or username == f"form:{data['form']}"
    return False


def fire_webhook(session, token: str, payload: dict[str, Any] | None) -> dict[str, Any]:
    """Another system called a workflow's address: run it for the record it named."""
    row = session.scalar(select(AutomationGraph).where(AutomationGraph.webhook_token == str(token or "")))
    rule = row.rule if row is not None else None
    trigger = trigger_of(row.published) if row is not None else None
    if (rule is None or rule.deleted_at is not None or trigger is None
            or trigger["data"].get("event") != "WEBHOOK"):
        raise NotFoundError("No workflow listens at that address.")
    if not rule.enabled:
        raise ValidationError("That workflow is paused.")
    resource = _resource(rule.resource_type)
    body = payload if isinstance(payload, dict) else {}
    record_id = parse_uuid(body.get("record_id"), field="record_id")
    record = session.get(resource.model, record_id)
    if record is None or getattr(record, "deleted_at", None) is not None:
        raise NotFoundError("That record does not exist.")
    token_ = _ACTIVE.set(True)
    try:
        run = evaluate(session, rule, principal=None, dry_run=False, records=[record],
                       event={"event": "WEBHOOK", "record": resource.label_for(record)}, graph_row=row)
    finally:
        _ACTIVE.reset(token_)
    return {"accepted": True, "run_id": run["id"], "fired": run["fired"]}


# ── Waiting, and resuming ────────────────────────────────────────────────


def resume(session, wait: AutomationWait, port: str) -> dict[str, Any] | None:
    """Carry a parked record on from its node, down `port`, in its own version."""
    wait.status = "RESUMED"
    wait.outcome = port
    wait.resumed_at = now()
    rule = session.get(AlertRule, wait.rule_id)
    if rule is None or rule.deleted_at is not None:
        wait.status = "CANCELLED"
        session.flush()
        return None
    version = session.scalar(select(AutomationVersion).where(
        AutomationVersion.rule_id == rule.id, AutomationVersion.version == wait.version))
    graph = (version.graph if version else None) or ensure(session, rule).published
    resource = _resource(wait.resource_type)
    record = session.get(resource.model, UUID(wait.record_id)) if resource else None
    if record is None or getattr(record, "deleted_at", None) is not None:
        wait.status = "CANCELLED"
        session.flush()
        return None
    from src.services import workflows

    run = AlertRuleRun(rule_id=rule.id, dry_run=False, started_at=now())
    session.add(run)
    session.flush()
    walk = Walk(rule=rule, graph=graph, resource=resource, dry_run=False, version=wait.version, run=run)
    match = _matches_for(resource, [record])[0]
    starts = [(edge["target"], [match]) for edge in _outgoing(graph).get(wait.node_id, [])
              if edge["port"] == port]
    for edge in _outgoing(graph).get(wait.node_id, []):
        if edge["port"] == port:
            walk.edges_taken[edge["id"]] = walk.edges_taken.get(edge["id"], 0) + 1
    walk.count(wait.node_id, port if port != "out" else "resumed")
    token = _ACTIVE.set(True)
    try:
        _walk(session, walk, starts)
    finally:
        _ACTIVE.reset(token)
    entry = walk.records.get(match.id) or {"actions": [], "nodes": []}
    run.finished_at = now()
    run.matched = 1
    run.fired = 1 if entry["actions"] else 0
    run.detail = {
        "sample": [{"record": match.label, "record_id": match.id, "path": match.path,
                    "state": "FIRED" if entry["actions"] else "SKIPPED",
                    "actions": entry["actions"], "nodes": entry["nodes"]}],
        "by_action": workflows._tally([{"actions": entry["actions"]}]),
        "nodes": walk.counts, "edges": walk.edges_taken, "parked": walk.parked,
        "version": wait.version,
        "trigger": {"event": "RESUME", "record": match.label, "port": port},
    }
    if entry["actions"]:
        rule.last_triggered_at = run.finished_at
        rule.trigger_count = int(rule.trigger_count or 0) + 1
    session.flush()
    return workflows.serialize_run(run)


APPROVAL_KIND = "automation"
_REGISTERED = False


def register_provider() -> None:
    """Approvals know "an automation asked" — deciding one resumes the workflow."""
    global _REGISTERED
    if _REGISTERED:
        return
    from src.services import approvals

    def apply(session, row, *, approved: bool, principal=None, comment: str = "", **_: Any) -> None:
        wait = session.scalar(select(AutomationWait).where(
            AutomationWait.approval_id == str(row.id), AutomationWait.status == "PENDING"))
        if wait is not None:
            resume(session, wait, "approved" if approved else "rejected")

    approvals.register(approvals.Provider(
        kind=APPROVAL_KIND, label="Workflow approval", icon="flow",
        decide_permission="approvals.decide", sla_hours=24, apply=apply,
        reject_needs_comment=False,
    ))
    _REGISTERED = True


def run_due(session, *, principal=None) -> dict[str, int]:
    """The scheduler's pass: scheduled workflows that are due, and delays that are over."""
    moment = now()
    ran = resumed = 0
    rows = session.execute(
        select(AlertRule, AutomationGraph)
        .join(AutomationGraph, AutomationGraph.rule_id == AlertRule.id)
        .where(AlertRule.enabled.is_(True), AlertRule.deleted_at.is_(None))
    ).unique().all()
    for rule, graph_row in rows:
        trigger = trigger_of(graph_row.published)
        if trigger is None or trigger["data"].get("event") != "SCHEDULE":
            continue
        expression = str(trigger["data"].get("schedule") or "")
        try:
            due = cron_due(_cron(expression), graph_row.last_scheduled_at or graph_row.published_at, moment)
        except ValidationError:
            continue
        graph_row.last_scheduled_at = moment
        if due:
            evaluate(session, rule, principal=None, dry_run=False, graph_row=graph_row,
                     event={"event": "SCHEDULE", "schedule": expression})
            ran += 1
    waits = session.scalars(
        select(AutomationWait).where(AutomationWait.status == "PENDING", AutomationWait.kind == "DELAY",
                                     AutomationWait.due_at <= moment).limit(200)
    ).all()
    for wait in waits:
        resume(session, wait, "out")
        resumed += 1
    session.flush()
    return {"scheduled": ran, "resumed": resumed}


def run_scheduler(session, *, principal) -> dict[str, Any]:
    principal.require(PERMISSION)
    result = run_due(session, principal=principal)
    return {**result, "ran_at": iso(now())}


_LAST_CATCH_UP: list[float] = [0.0]
CATCH_UP_SECONDS = 60


def catch_up() -> bool:
    """Run the scheduler off a request, at most once a minute per process.

    There is no worker process (see `core/background`), so — like the work
    planning scheduler — the first automations request after a minute starts a
    pass in the background. Never in tests: work started behind a test's back
    is a race.
    """
    import time

    from src.config import Config
    from src.core import background

    if Config.ENVIRONMENT == "test":
        return False
    if time.monotonic() - _LAST_CATCH_UP[0] < CATCH_UP_SECONDS:
        return False
    _LAST_CATCH_UP[0] = time.monotonic()

    def work() -> None:
        from src.core.db import session_scope

        with session_scope() as own:
            run_due(own)

    background.spawn(work, name="automation-scheduler")
    return True


def pending_waits(session, rule_id: Any) -> list[dict[str, Any]]:
    rows = session.scalars(
        select(AutomationWait).where(AutomationWait.rule_id == rule_id, AutomationWait.status == "PENDING")
        .order_by(AutomationWait.created_at.desc()).limit(25)
    ).all()
    return [{"id": str(row.id), "node_id": row.node_id, "kind": row.kind, "record": row.record_label,
             "record_id": row.record_id, "due_at": iso(row.due_at), "approval_id": row.approval_id}
            for row in rows]


def catalogue_extras(session) -> dict[str, Any]:
    """What the canvas palette offers beyond the form editor's catalogue."""
    from src.models.forms import IntakeForm

    try:
        forms = session.execute(
            select(IntakeForm.slug, IntakeForm.name, IntakeForm.target)
            .where(IntakeForm.deleted_at.is_(None)).order_by(IntakeForm.name)
        ).all()
    except Exception:  # noqa: BLE001 - forms are another feature; absent is fine
        forms = []
    return {
        "triggers": [{"event": key, **value, "needs": value.get("needs", [])} for key, value in TRIGGERS.items()],
        "flow": [{"kind": key, "label": value["label"], "description": value["description"],
                  "needs": value["needs"], "ports": value["ports"]} for key, value in FLOW.items()],
        "forms": [{"slug": slug, "name": name, "target": target} for slug, name, target in forms],
        "approvals": True,
        "limits_graph": {"max_nodes": MAX_NODES, "max_wait_minutes": MAX_WAIT_MINUTES},
    }

