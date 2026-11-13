"""Condition → action automation (§49): the engine, and only the engine.

An automation here is one sentence — *when records look like this, do these
things* — and every part of it already exists somewhere else in the platform.
The condition is the react-awesome-query-builder tree the advanced search
produces, compiled by `core/rules.py`. The records it matches are selected
through the same `explorer` declaration every list, chart and export reads. The
actions write through the same services a person writes through. This module
adds no second way to ask a question and no second way to make a change; it
adds the *loop* between them.

Five decisions carry the design.

**The cooldown is held per record, not per rule.** This is the difference
between the requirement and a thing that looks like it. A rule cooling down as
a whole would send forty messages about forty breached tickets in one run and
then go quiet about the forty-first; §49 asks for the opposite. So "we have
already said this" is a fact about *this rule and this record*, kept in
`alert_rule_fires` and upserted rather than appended — state, not history.

**A dry run is the same code path with the actions switched off.** Not a second
evaluator: a preview that walks different code is a preview that can disagree
with the thing it previews, which is the one thing a preview must not do. So
`evaluate()` takes `dry_run` and every action consults it in exactly one place.

**An action that fails is recorded, never raised.** A webhook whose host is
down must not lose the notification beside it, and it must not lose the
cooldown either — a run that half-happened and then rolled back would fire the
same actions again on the next pass. Outcomes are collected per action.

**The run is bounded twice over.** `MAX_MATCHES` caps what one evaluation will
look at, because a rule matching a whole table is a rule that needs narrowing
rather than a request that needs patience. `MAX_FIRES` caps what one run will
*act on*, and the remainder is reported as deferred rather than dropped: their
cooldown never started, so the next run picks them up.

**Actions are declared beside what runs them.** `ACTIONS` states each kind's
label, what it needs and what performs it, and the API publishes that list —
so the editor renders from the same declaration the engine executes, and a new
action kind reaches the screen the day it is written (§76).
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field as dataclass_field
from datetime import timedelta
from typing import Any, Callable
from urllib.parse import urlparse
from uuid import UUID

from sqlalchemy import func, select

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import ForbiddenError, ValidationError
from src.core.naming import identifier, sequence_of
from src.core.pagination import parse_uuid
from src.core.rules import MAX_RULES, compile_tree, describe_tree, rule_count
from src.core.vocabulary import PRIORITY
from src.core.repository import get_or_404
from src.models.business import Task
from src.models.content import EmailMessage, EmailTemplate
from src.models.identity import User
from src.models.platform import AlertRule, AlertRuleFire, AlertRuleRun
from src.services.explorer import resource_for, resources

#: Holding this is what separates somebody who reads the automations from
#: somebody who can make the platform email forty people. Reading the list
#: needs it too: a rule's condition names the fields and values of records the
#: reader may not be able to see.
PERMISSION = "automations.manage"

#: How many matching records one evaluation will look at. Beyond this the rule
#: is too broad to be an automation, and the run says so rather than quietly
#: working on a prefix.
MAX_MATCHES = 500

#: How many records one run will *act on*. Fifty notifications is already a
#: lot of noise from one pass; the rest keep their place in the queue because
#: nothing recorded a cooldown for them.
MAX_FIRES = 50

#: The per-record outcomes kept on the run row. The counts beside them are the
#: summary — this is a sample for the drawer, not a second copy of it.
SAMPLE_SIZE = 25

#: An unreachable webhook must not hold a request open. Short, because this
#: runs inside the "run now" call until scheduling exists (§23).
WEBHOOK_TIMEOUT_SECONDS = 5

SEVERITIES = ("INFO", "WARNING", "CRITICAL")

#: `{record}` and friends in an action's text. A whitelist substitution rather
#: than `str.format_map`, which would let `{record.__class__}` reach into the
#: object graph from a field somebody typed.
_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")


# ── The action catalogue ─────────────────────────────────────────────────


@dataclass(frozen=True)
class Match:
    """One record a rule matched, reduced to what an action needs of it."""

    id: str
    label: str
    path: str
    row: Any


@dataclass(frozen=True)
class Action:
    """One kind of thing a rule can do.

    `needs` is what the editor must ask for and what `validate` insists on, in
    one place — a field the engine reads and the form never offers is a rule
    that cannot work, and the opposite is a form asking for something nothing
    uses.
    """

    kind: str
    label: str
    description: str
    needs: tuple[str, ...] = ()
    run: Callable[..., str] = dataclass_field(default=lambda **_: "")


def _text(template: str, match: Match, rule: AlertRule) -> str:
    """Fill `{record}`, `{rule}` and `{link}` in an action's own wording."""
    values = {
        "record": match.label,
        "rule": rule.name,
        "link": match.path,
        "severity": rule.severity,
    }
    return _PLACEHOLDER.sub(lambda hit: values.get(hit.group(1), hit.group(0)), template or "")


def _notify(session, *, rule: AlertRule, match: Match, config: dict[str, Any], **_: Any) -> str:
    """Write an in-app notification, through the service everything else uses."""
    from src.services import notifications

    recipients = _recipient_ids(session, config, rule)
    if not recipients:
        raise ValidationError("that notification names nobody to send it to")
    title = _text(str(config.get("title") or "{rule}: {record}"), match, rule)
    body = _text(str(config.get("body") or ""), match, rule)
    for user_id in recipients:
        notifications.publish(
            session,
            user_id=user_id,
            title=title[:240],
            body=body,
            category="ALERT",
            severity=rule.severity,
            link=match.path,
            resource_type=rule.resource_type,
            resource_id=match.id,
            group_key=f"automation:{rule.id}",
            metadata={"rule_id": str(rule.id), "rule": rule.name},
        )
    return f"notified {len(recipients)}"


def _email(session, *, rule: AlertRule, match: Match, config: dict[str, Any], **_: Any) -> str:
    """Queue an email into the platform's own mailbox.

    Deliberately not an SMTP call. There is no mail transport in the template
    and pretending otherwise would make a rule report success for a message
    nobody receives; writing it into `email_messages` puts it where `/mail`
    shows it, which is both honest and inspectable. The subject and body come
    from an `EmailTemplate` when one is named, because that is where the
    platform already keeps its wording (§11).
    """
    recipients = _recipient_ids(session, config, rule)
    if not recipients:
        raise ValidationError("that email names nobody to send it to")
    people = session.scalars(select(User).where(User.id.in_(recipients))).all()

    subject = str(config.get("subject") or "{rule}: {record}")
    body = str(config.get("body") or "")
    code = str(config.get("template") or "").strip()
    if code:
        template = session.scalar(select(EmailTemplate).where(EmailTemplate.code == code))
        if template is None:
            raise ValidationError(f"no email template is called {code!r}")
        subject = template.subject
        body = template.body_text or template.body_html or ""

    message = EmailMessage(
        message_ref=_next_message_ref(session),
        subject=_text(subject, match, rule)[:300],
        from_name="Nucleus automation",
        from_email="automation@nucleus.local",
        to_recipients=[{"name": person.full_name, "email": person.email} for person in people],
        body_text=_text(body, match, rule),
        preview=_text(body, match, rule)[:400] or None,
        # OUTBOX and not SENT: nothing has transported it. The folder is the
        # whole claim being made about this row.
        folder="OUTBOX",
        is_read=True,
        priority="HIGH" if rule.severity == "CRITICAL" else "NORMAL",
        owner_id=rule.owner_id,
        sent_at=now(),
    )
    session.add(message)
    session.flush()
    return f"queued to {len(people)}"


def _task(session, *, rule: AlertRule, match: Match, config: dict[str, Any], **_: Any) -> str:
    """Raise a task, in the same queue every other task lives in."""
    assignee = parse_uuid(config.get("assignee_id"), field="assignee_id") if config.get(
        "assignee_id"
    ) else None
    row = Task(
        reference=_next_task_reference(session),
        title=_text(str(config.get("title") or "{rule}: {record}"), match, rule)[:240],
        description=_text(str(config.get("body") or ""), match, rule) or None,
        status="NEW",
        priority=str(config.get("priority") or "HIGH").upper(),
        kind="TASK",
        assignee_id=assignee,
        requester_id=rule.owner_id,
        metadata_json={"rule_id": str(rule.id), "matched": match.id},
    )
    session.add(row)
    session.flush()
    return row.reference


def _webhook(session, *, rule: AlertRule, match: Match, config: dict[str, Any], **_: Any) -> str:
    """POST the match to an address somebody configured.

    Bounded on purpose: http(s) only, one attempt, no redirects followed, and a
    short timeout — this runs inside the request until §23 gives it a worker.
    The URL is validated when the rule is *saved* as well, so a rule cannot sit
    in the table carrying a target the engine will refuse.
    """
    from src.core import features

    if not features.job_allowed("automation.webhook-action"):
        # Recorded as the action's outcome, so the run says why nothing was sent.
        return "skipped: webhooks are switched off"
    url = _webhook_url(config.get("url"))
    payload = json.dumps(
        {
            "rule": {"id": str(rule.id), "name": rule.name, "severity": rule.severity},
            "resource_type": rule.resource_type,
            "record": {"id": match.id, "label": match.label, "path": match.path},
            "at": iso(now()),
        }
    ).encode()
    request = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "Nucleus-Automation/1"},
    )
    opener = urllib.request.build_opener(_NoRedirect())
    with opener.open(request, timeout=WEBHOOK_TIMEOUT_SECONDS) as response:
        return f"POST {response.status}"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A webhook target that answers with a redirect is not the target."""

    def redirect_request(self, *_args: Any, **_kwargs: Any):  # noqa: D102
        return None


def _owner_principal(session, rule: AlertRule):
    """Who an automation writes records *as*: its author, labelled as the rule.

    Records an automation changes are audited to the person who wrote it —
    somebody has to answer for "why did this ticket's priority change at three
    in the morning" — with the rule's name beside them so the ledger says it
    was the rule and not them at the keyboard.
    """
    from src.core.auth import Principal

    owner = rule.owner
    return Principal(
        user_id=owner.id if owner else None, subject="", email=owner.email if owner else "",
        username=f"automation:{rule.id}", full_name=f"{rule.name} (automation)"[:160],
        role_code="SYSTEM",
        permissions=frozenset({"records.view", "records.create", "records.update"}),
    )


def _update_field(session, *, rule: AlertRule, match: Match, config: dict[str, Any], **_: Any) -> str:
    """Set one field on the matched record, through the records API's own rules."""
    from src.services import record_writes

    resource = resources()[rule.resource_type]
    name = str(config.get("field") or "")
    value = config.get("value")
    if isinstance(value, str):
        value = _text(value, match, rule)
    values, problems = record_writes.coerce(session, resource, {name: value}, creating=False)
    if problems:
        raise ValidationError(problems[0]["message"])
    changed = record_writes.apply_values(
        session, resource, match.row, values, principal=_owner_principal(session, rule)
    )
    return f"{name} set" if changed else f"{name} already set"


def _assign(session, *, rule: AlertRule, match: Match, config: dict[str, Any], **_: Any) -> str:
    """Give the matched record to somebody: a named person, or the rule's owner."""
    from src.services import automation_graph

    resource = resources()[rule.resource_type]
    name = automation_graph.assignable_field(resource)
    if name is None:
        raise ValidationError(f"{resource.label} have nobody to assign.")
    person = config.get("assignee_id") or (str(rule.owner_id) if rule.owner_id else None)
    if not person:
        raise ValidationError("That assignment names nobody.")
    return _update_field(session, rule=rule, match=match, config={"field": name, "value": person})


def _create_record(session, *, rule: AlertRule, match: Match, config: dict[str, Any], **_: Any) -> str:
    """Create a record in any dataset, its text filled in from the match."""
    from src.services import record_writes

    values = {
        key: _text(value, match, rule) if isinstance(value, str) else value
        for key, value in (config.get("values") or {}).items()
    }
    created = record_writes.create(
        session, config.get("resource_type"), values, principal=_owner_principal(session, rule)
    )
    return str(created.get("subtitle") or created.get("title") or created.get("id"))


#: The catalogue. Declared here, published by the API, rendered by the editor.
ACTIONS: dict[str, Action] = {
    action.kind: action
    for action in (
        Action(
            kind="NOTIFY",
            label="Notify people",
            description="An in-app notification, delivered live if they are looking.",
            needs=("recipients",),
            run=_notify,
        ),
        Action(
            kind="EMAIL",
            label="Send an email",
            description="Queued into the mailbox; an email template supplies the wording.",
            needs=("recipients",),
            run=_email,
        ),
        Action(
            kind="TASK",
            label="Raise a task",
            description="A task in the normal queue, so the follow-up is visible work.",
            needs=(),
            run=_task,
        ),
        Action(
            kind="WEBHOOK",
            label="Call a webhook",
            description="One POST to an address you configure, with the match in the body.",
            needs=("url",),
            run=_webhook,
        ),
        Action(
            kind="UPDATE_FIELD",
            label="Update a field",
            description="Set one field on the record, validated like a form edit.",
            needs=("field",),
            run=_update_field,
        ),
        Action(
            kind="ASSIGN",
            label="Assign",
            description="Give the record to a person, or to the workflow's owner.",
            needs=("assignee",),
            run=_assign,
        ),
        Action(
            kind="CREATE_RECORD",
            label="Create a record",
            description="A new record in any dataset, filled in from this one.",
            needs=("resource_type",),
            run=_create_record,
        ),
    )
}

#: What the step-by-step form editor can configure. The rest are canvas-only.
FORM_ACTIONS = ("NOTIFY", "EMAIL", "TASK", "WEBHOOK")


def catalogue(session, *, principal) -> dict[str, Any]:
    """What the editor may offer: the resources, the actions, and the roles.

    The first two come from declarations rather than from a list typed into the
    page, so the editor cannot offer a resource the engine cannot select from
    or an action nothing executes.

    The roles come from the table rather than from `/admin/roles`, which needs
    `roles.manage` — a permission a manager who may write automations does not
    hold. Addressing an action to a role is the option that matters most here,
    so the picker for it cannot depend on being an administrator.
    """
    principal.require(PERMISSION)
    from src.models.identity import Role
    from src.services import automation_graph

    roles = session.scalars(select(Role).order_by(Role.rank.desc())).all()
    return {
        "roles": [{"code": role.code, "name": role.name} for role in roles],
        "resources": [
            {"key": resource.key, "label": resource.label, "path": resource.path}
            for resource in sorted(resources().values(), key=lambda item: item.label)
            if principal.can(resource.permission)
        ],
        "actions": [
            {
                "kind": action.kind,
                "label": action.label,
                "description": action.description,
                "needs": list(action.needs),
            }
            for action in ACTIONS.values()
            if action.kind in FORM_ACTIONS
        ],
        # Everything the canvas palette offers: every action, the flow steps
        # (wait, approval) and the triggers. Separate from `actions` so the
        # form editor keeps offering only what it can configure.
        "canvas_actions": [
            {
                "kind": action.kind,
                "label": action.label,
                "description": action.description,
                "needs": list(action.needs),
            }
            for action in ACTIONS.values()
        ],
        **automation_graph.catalogue_extras(session),
        "severities": list(SEVERITIES),
        # The priorities a TASK action may set, from the vocabulary the task
        # table itself uses — so the editor cannot offer one the record
        # endpoint would refuse.
        "priorities": list(PRIORITY),
        "limits": {
            "max_matches": MAX_MATCHES,
            "max_fires": MAX_FIRES,
            "max_rules": MAX_RULES,
        },
    }


# ── Evaluation ───────────────────────────────────────────────────────────


def evaluate(session, rule: AlertRule, *, principal, dry_run: bool) -> dict[str, Any]:
    """Run one rule: select what matches, act on what is not cooling down.

    The graph engine (`automation_graph.evaluate`) is the one evaluator: a
    form-built rule is a straight-line graph, so "run now" on it walks exactly
    the code a canvas-built workflow walks. Returns the run as the page reads
    it; the run row is written whichever way the evaluation went.
    """
    from src.services import automation_graph

    return automation_graph.evaluate(session, rule, principal=principal, dry_run=dry_run)


def _matches(session, rule: AlertRule, *, principal, tree: Any = None) -> tuple[list[Match], bool]:
    """The records this rule's condition selects, capped at `MAX_MATCHES`.

    Selected in PostgreSQL through the resource's own declaration, so a rule
    reads the same rows the equivalent saved search would (§71). A rule with an
    empty condition matches *nothing*: an automation that fires on every row in
    a table is never what somebody meant, and reading "no conditions" as "all"
    is the reading that sends the forty messages.
    """
    resource = resource_for(rule.resource_type, principal=principal)
    predicate = compile_tree(tree, resource.fields)
    if predicate is None:
        return [], False

    statement = select(resource.model).where(predicate)
    deleted = getattr(resource.model, "deleted_at", None)
    if deleted is not None:
        statement = statement.where(deleted.is_(None))

    rows = session.scalars(statement.limit(MAX_MATCHES + 1)).unique().all()
    capped = len(rows) > MAX_MATCHES
    return [
        Match(
            id=str(row.id),
            label=resource.label_for(row),
            path=f"{resource.path}/{row.id}",
            row=row,
        )
        for row in rows[:MAX_MATCHES]
    ], capped


def _reason(error: Exception) -> str:
    """One line a person can act on, for the run drawer."""
    if isinstance(error, urllib.error.HTTPError):
        return f"HTTP {error.code}"
    if isinstance(error, urllib.error.URLError):
        return f"unreachable: {error.reason}"
    text = str(error).strip() or error.__class__.__name__
    return text[:200]


def _cooldown_ledger(session, rule: AlertRule, ids: list[str]) -> dict[str, AlertRuleFire]:
    """The rule's fire ledger for exactly the records in hand.

    One query for the whole batch: the alternative is a select per matched
    record, which for five hundred matches is five hundred round trips to
    answer one question.
    """
    if not ids:
        return {}
    rows = session.scalars(
        select(AlertRuleFire).where(
            AlertRuleFire.rule_id == rule.id, AlertRuleFire.record_id.in_(ids)
        )
    ).all()
    return {row.record_id: row for row in rows}


def _remember(session, rule: AlertRule, match: Match, entry: AlertRuleFire | None) -> None:
    """Start this record's cooldown, upserting the ledger row."""
    if entry is None:
        entry = AlertRuleFire(rule_id=rule.id, record_id=match.id, fire_count=0)
        session.add(entry)
    entry.record_label = match.label[:240]
    entry.last_fired_at = now()
    entry.fire_count = int(entry.fire_count or 0) + 1


def _tally(outcomes: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    """Per-action success and failure counts, over the sample."""
    tally: dict[str, dict[str, int]] = {}
    for outcome in outcomes:
        for item in outcome.get("actions") or []:
            counts = tally.setdefault(str(item["kind"]), {"ok": 0, "failed": 0})
            counts["ok" if item["ok"] else "failed"] += 1
    return tally


# ── Reading and writing rules ────────────────────────────────────────────


def list_rules(session, args, *, principal) -> dict[str, Any]:
    """Every automation, newest trouble first.

    Not scoped by owner: an automation is an operational object rather than a
    personal one — it emails colleagues and raises tasks in a shared queue, so
    everybody who may write one may see them all. `automations.manage` is the
    whole gate, and *editing* is still the owner's (or an administrator's).
    """
    principal.require(PERMISSION)
    statement = select(AlertRule).where(AlertRule.deleted_at.is_(None))

    resource_type = str(args.get("resource_type") or "").strip()
    if resource_type:
        resource_for(resource_type, principal=principal)
        statement = statement.where(AlertRule.resource_type == resource_type)

    state = str(args.get("state") or "").strip().upper()
    if state == "ENABLED":
        statement = statement.where(AlertRule.enabled.is_(True))
    elif state == "PAUSED":
        statement = statement.where(AlertRule.enabled.is_(False))

    rows = session.scalars(
        statement.order_by(AlertRule.enabled.desc(), AlertRule.name.asc())
    ).unique().all()

    from src.models.automation_graphs import AutomationGraph
    from src.services import automation_graph

    automation_graph.catch_up()
    graphs = {
        row.rule_id: row
        for row in session.scalars(
            select(AutomationGraph).where(AutomationGraph.rule_id.in_([rule.id for rule in rows]))
        ).unique().all()
    } if rows else {}

    return {
        "items": [_serialize(row, principal, graph=graphs.get(row.id)) for row in rows],
        "total": len(rows),
        "counts": _counts(session),
        "can_manage": True,
    }


def _counts(session) -> dict[str, int]:
    """The strip's numbers, computed where the rows are (§71)."""
    live = select(AlertRule).where(AlertRule.deleted_at.is_(None)).subquery()
    row = session.execute(
        select(
            func.count().label("total"),
            func.count().filter(live.c.enabled.is_(True)).label("enabled"),
            func.coalesce(func.sum(live.c.trigger_count), 0).label("fires"),
        ).select_from(live)
    ).one()
    return {"total": int(row.total), "enabled": int(row.enabled), "fires": int(row.fires)}


def get(session, rule_id: Any, *, principal) -> dict[str, Any]:
    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    from src.services import automation_graph

    detail = _serialize(rule, principal, graph=automation_graph.ensure(session, rule))
    detail["runs"] = [serialize_run(run) for run in rule.runs[:10]]
    detail["waiting"] = automation_graph.pending_waits(session, rule.id)
    detail["cooling_down"] = _cooling_down(session, rule)
    return detail


def _cooling_down(session, rule: AlertRule) -> list[dict[str, Any]]:
    """Which records this rule is currently holding back, and until when.

    The answer to "why has it gone quiet", which is the question a paused-
    looking automation always raises. Derived from the ledger and the rule's
    own cooldown rather than stored: a cooldown somebody shortened has to take
    effect immediately, and a stored expiry would still be yesterday's.
    """
    minutes = max(int(rule.cooldown_minutes or 0), 0)
    if minutes == 0:
        return []
    threshold = now() - timedelta(minutes=minutes)
    rows = session.scalars(
        select(AlertRuleFire)
        .where(AlertRuleFire.rule_id == rule.id, AlertRuleFire.last_fired_at > threshold)
        .order_by(AlertRuleFire.last_fired_at.desc())
        .limit(25)
    ).all()
    return [
        {
            "record_id": row.record_id,
            "record": row.record_label,
            "last_fired_at": iso(row.last_fired_at),
            "until": iso(row.last_fired_at + timedelta(minutes=minutes)),
            "fire_count": int(row.fire_count or 0),
        }
        for row in rows
    ]


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(PERMISSION)
    from src.services import automation_graph

    data = payload if isinstance(payload, dict) else {}
    if data.get("graph") is not None:
        # Written on the canvas: the graph is the definition, and the columns
        # the list reads are projected from it when it is installed.
        graph = automation_graph.normalize(data["graph"])
        trigger = automation_graph.trigger_of(graph) or {"data": {}}
        seed = {
            "name": data.get("name"),
            "description": data.get("description"),
            "resource_type": trigger["data"].get("resource_type") or "task",
            "condition_tree": None,
            "actions": [{"kind": "TASK"}],
        }
        # Paused unless asked otherwise, like a rule from the wizard: a starter
        # graph is installed straight away, and it must not start notifying
        # people about every new record before its author has finished it.
        seed["enabled"] = False
        for key in ("severity", "enabled", "cooldown_minutes"):
            if key in data:
                seed[key] = data[key]
        values = _validated(session, seed, principal=principal, partial=False)
        rule = AlertRule(owner_id=getattr(principal, "user_id", None), **values)
        if "cooldown_minutes" not in data:
            rule.cooldown_minutes = 0
        session.add(rule)
        session.flush()
        graph_row = automation_graph.create_with_graph(session, rule, graph, principal=principal)
    else:
        values = _validated(session, data, principal=principal, partial=False)
        rule = AlertRule(owner_id=getattr(principal, "user_id", None), **values)
        session.add(rule)
        session.flush()
        graph_row = automation_graph.ensure(session, rule)
    audit.record(
        session,
        action="automation.create",
        resource_type="alert_rule",
        resource_id=rule.id,
        resource_label=rule.name,
        principal=principal,
        after=_audit_state(rule),
    )
    return _serialize(rule, principal, graph=graph_row)


def update(session, rule_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    _require_own(rule, principal)
    before = _audit_state(rule)
    from src.services import automation_graph

    values = _validated(session, payload, principal=principal, partial=True)
    structural = {"resource_type", "condition_tree", "actions", "schedule"} & set(values)
    if structural:
        # The form editor changed what the workflow *is*: refused for a graph
        # it cannot represent, carried into a new version otherwise — both
        # editors edit one stored definition.
        automation_graph.check_form_edit(session, rule)
    for name, value in values.items():
        setattr(rule, name, value)
    session.flush()
    if structural:
        automation_graph.after_form_edit(session, rule, principal=principal)
    audit.record(
        session,
        action="automation.update",
        resource_type="alert_rule",
        resource_id=rule.id,
        resource_label=rule.name,
        principal=principal,
        before=before,
        after=_audit_state(rule),
    )
    return _serialize(rule, principal, graph=automation_graph.ensure(session, rule))


def remove(session, rule_id: Any, *, principal) -> dict[str, Any]:
    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    _require_own(rule, principal)
    rule.deleted_at = now()
    rule.enabled = False
    session.flush()
    audit.record(
        session,
        action="automation.delete",
        resource_type="alert_rule",
        resource_id=rule.id,
        resource_label=rule.name,
        principal=principal,
        before=_audit_state(rule),
    )
    return {"deleted": True, "id": str(rule.id)}


def run_now(session, rule_id: Any, payload: dict[str, Any] | None, *, principal) -> dict[str, Any]:
    """Evaluate a rule on demand — as a dry run, or for real.

    A disabled rule may still be dry-run: reading what it *would* do is how
    somebody decides whether to enable it, and refusing that is refusing the
    only safe way to find out. Firing a disabled rule is refused, because
    "paused" has to mean something.
    """
    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    dry_run = bool((payload or {}).get("dry_run", True))
    if not dry_run:
        _require_own(rule, principal)
        if not rule.enabled:
            raise ValidationError(
                "That automation is paused. Dry-run it, or enable it first.",
                details={"rule_id": str(rule.id)},
            )
    answer = evaluate(session, rule, principal=principal, dry_run=dry_run)
    if not dry_run:
        audit.record(
            session,
            action="automation.run",
            resource_type="alert_rule",
            resource_id=rule.id,
            resource_label=rule.name,
            principal=principal,
            metadata={"matched": answer["matched"], "fired": answer["fired"]},
            message=f"{answer['fired']} of {answer['matched']} matches acted on",
            # Audited, but not in the human feed (§35). An automation firing is
            # the platform doing its job, not a person doing something — and a
            # feed of "3 of 11 matches acted on" every quarter of an hour
            # drowns everything a colleague actually did. The run history on
            # the rule is where this belongs, and it is already there.
            activity=False,
        )
    return answer


def runs(session, rule_id: Any, *, principal, limit: int = 25) -> dict[str, Any]:
    principal.require(PERMISSION)
    rule = _rule(session, rule_id)
    rows = session.scalars(
        select(AlertRuleRun)
        .where(AlertRuleRun.rule_id == rule.id)
        .order_by(AlertRuleRun.started_at.desc())
        .limit(max(1, min(int(limit), 100)))
    ).all()
    return {"items": [serialize_run(row) for row in rows], "total": len(rows)}


# ── Validation ───────────────────────────────────────────────────────────


def _validated(
    session, payload: dict[str, Any] | None, *, principal, partial: bool
) -> dict[str, Any]:
    """Everything a rule may be given, checked before anything is written.

    The condition is compiled here and the compiled form thrown away: a rule
    that cannot compile must be refused at the point somebody can still fix it,
    not at three in the morning when it was due to fire.
    """
    data = payload if isinstance(payload, dict) else {}
    values: dict[str, Any] = {}

    if "name" in data or not partial:
        name = str(data.get("name") or "").strip()
        if not name:
            raise ValidationError("An automation needs a name.")
        values["name"] = name[:200]

    if "description" in data:
        values["description"] = str(data.get("description") or "").strip()[:2000] or None

    resource_type = str(data.get("resource_type") or "").strip()
    if resource_type or not partial:
        resource = resource_for(resource_type or "task", principal=principal)
        values["resource_type"] = resource.key
    else:
        resource = None

    if "condition_tree" in data or not partial:
        tree = data.get("condition_tree")
        if tree is not None and not isinstance(tree, dict):
            raise ValidationError("condition_tree must be a query-builder tree")
        spec = (resource or resource_for(str(data.get("resource_type") or "task"),
                                         principal=principal)).fields
        compile_tree(tree, spec)
        values["condition_tree"] = tree
        # Stored beside the tree so the list can say what a rule watches for
        # without every card compiling a tree, and rendered by the same
        # function the inspector uses so the two cannot disagree (§51).
        values["condition_text"] = describe_tree(tree, spec) or None

    if "actions" in data or not partial:
        values["actions"] = _validated_actions(session, data.get("actions"), resource)

    if "severity" in data:
        severity = str(data.get("severity") or "WARNING").upper()
        if severity not in SEVERITIES:
            raise ValidationError(
                "Unknown severity.", details={"severity": severity, "allowed": list(SEVERITIES)}
            )
        values["severity"] = severity

    if "enabled" in data:
        values["enabled"] = bool(data.get("enabled"))

    if "cooldown_minutes" in data:
        minutes = _whole(data.get("cooldown_minutes"), "cooldown_minutes")
        if not 0 <= minutes <= 60 * 24 * 30:
            raise ValidationError("A cooldown runs from 0 minutes to 30 days.")
        values["cooldown_minutes"] = minutes

    if "schedule" in data:
        values["schedule"] = _cron(str(data.get("schedule") or ""))

    return values


def _validated_actions(session, raw: Any, resource=None) -> list[dict[str, Any]]:
    """The actions, each checked against its own declaration.

    A rule with no actions is refused rather than saved: it would evaluate,
    match, record fires and do nothing — an automation that looks like it is
    working and is not.
    """
    if not isinstance(raw, list) or not raw:
        raise ValidationError("An automation needs at least one action.")
    if len(raw) > 8:
        raise ValidationError("An automation runs at most 8 actions.")

    from src.services import automation_graph

    cleaned: list[dict[str, Any]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise ValidationError("each action must be an object")
        kind = str(entry.get("kind") or entry.get("type") or "").strip().upper()
        if kind not in FORM_ACTIONS:
            raise ValidationError(
                f"{kind or '(none)'} is not an action this platform can run.",
                details={"allowed": list(FORM_ACTIONS)},
            )
        cleaned.append(automation_graph.clean_action(session, entry, resource))
    return cleaned


def _recipient_config(entry: dict[str, Any]) -> dict[str, Any]:
    """Who an action addresses: named people, a role, or the rule's owner.

    A role rather than a list of people is the option that matters. A notice
    addressed by enumerating recipients silently misses whoever joined the team
    afterwards — which for an alert is the person most likely to be on call.

    Read from the nested `recipients` object, which is the one shape: the
    stored action carries it there, `_recipient_ids` resolves it from there,
    and a second accepted spelling at the action's top level would be a second
    place for the editor and the engine to disagree.
    """
    spec = entry.get("recipients")
    spec = spec if isinstance(spec, dict) else {}
    users = [str(parse_uuid(item, field="recipients")) for item in (spec.get("user_ids") or [])]
    role = str(spec.get("role") or "").strip().upper()
    owner = bool(spec.get("owner"))
    if not users and not role and not owner:
        raise ValidationError(
            "That action has to say who it reaches: people, a role, or the rule's owner."
        )
    return {"user_ids": users, "role": role, "owner": owner}


def _recipient_ids(session, config: dict[str, Any], rule: AlertRule) -> list[UUID]:
    """Resolve a recipient declaration to user ids, at the moment of firing.

    Resolved now and never stored: the point of addressing a *role* is that the
    answer changes as the team does — a rule addressed to whoever holds
    MANAGER must reach the person who joined last week.
    """
    spec = config.get("recipients")
    spec = spec if isinstance(spec, dict) else {}
    ids: list[UUID] = []

    for raw in spec.get("user_ids") or []:
        ids.append(parse_uuid(raw, field="recipients"))

    role = str(spec.get("role") or "").strip().upper()
    if role:
        from src.models.identity import Role

        ids.extend(
            session.scalars(
                select(User.id)
                .join(Role, User.role_id == Role.id)
                .where(Role.code == role, User.status == "ACTIVE", User.deleted_at.is_(None))
            ).all()
        )

    if spec.get("owner") and rule.owner_id:
        ids.append(rule.owner_id)

    seen: dict[UUID, None] = {}
    for item in ids:
        seen.setdefault(item, None)
    return list(seen)


def _webhook_url(raw: Any) -> str:
    """An http(s) address with a host, refused at save time if it is not.

    Checked here and read by the action, so a target the engine will not call
    cannot be stored by the editor.
    """
    url = str(raw or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValidationError(
            "A webhook needs a full http:// or https:// address.", details={"url": url}
        )
    if len(url) > 500:
        raise ValidationError("That webhook address is too long.")
    return url


def _cron(value: str) -> str:
    """A five-field cron expression, stored rather than interpreted.

    Nothing runs it yet — scheduling is §23 — and storing it now is what lets
    the page say when a rule is *meant* to run without pretending it does.
    Validated to five fields so the day a scheduler reads this column it is not
    reading somebody's prose.
    """
    text = " ".join(value.split())
    if not text:
        return "*/15 * * * *"
    if len(text.split(" ")) != 5:
        raise ValidationError(
            "A schedule is five cron fields — minute, hour, day, month, weekday.",
            details={"schedule": text},
        )
    return text[:32]


def _whole(value: Any, name: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as error:
        raise ValidationError(f"{name} must be a whole number") from error


def _rule(session, rule_id: Any) -> AlertRule:
    rule = get_or_404(
        session,
        AlertRule,
        parse_uuid(rule_id, field="rule_id"),
        "That automation does not exist.",
        live=True,
    )
    return rule


def _require_own(rule: AlertRule, principal) -> None:
    """Only the author changes a rule — or an administrator.

    An automation reaches other people's inboxes, so "anybody who may write one
    may rewrite yours" is the wrong default. `admin.access` is the exception
    because somebody has to be able to stop a rule whose author has left.
    """
    if rule.owner_id and rule.owner_id != getattr(principal, "user_id", None):
        if not principal.can("admin.access"):
            raise ForbiddenError("Only the author of an automation can change it.")


# ── Serialisation ────────────────────────────────────────────────────────


def _serialize(rule: AlertRule, principal, graph=None) -> dict[str, Any]:
    from src.services import automation_graph

    owner = rule.owner
    resource = resources().get(rule.resource_type)
    published = graph.published if graph is not None else None
    return {
        # What starts it, and which version of its graph runs — so the list can
        # say "Record created" rather than a cron line nobody set.
        "trigger": automation_graph.describe_trigger(published),
        "version": int(graph.version or 0) if graph is not None else 0,
        "has_draft": bool(graph is not None and graph.draft and graph.draft != graph.published),
        "linear": bool(published is None or automation_graph.linear(published) is not None),
        "id": str(rule.id),
        "name": rule.name,
        "description": rule.description,
        "resource_type": rule.resource_type,
        "resource_label": resource.label if resource else rule.resource_type,
        "resource_path": resource.path if resource else "",
        # Whether the dataset it names still exists. A rule that outlived its
        # dataset can never fire, and the page has to say *that* rather than
        # reporting the consequences — an empty action list and a condition
        # nothing can compile are symptoms, and shown as faults they send
        # somebody looking for a bug in a rule that is simply obsolete.
        "resource_exists": resource is not None,
        "enabled": bool(rule.enabled),
        "severity": rule.severity,
        "condition_tree": rule.condition_tree,
        "condition_text": rule.condition_text,
        "condition_count": rule_count(rule.condition_tree),
        "actions": rule.actions or [],
        "action_summary": [
            ACTIONS[str(item.get("kind"))].label
            for item in (rule.actions or [])
            if isinstance(item, dict) and str(item.get("kind")) in ACTIONS
        ],
        "schedule": rule.schedule,
        "cooldown_minutes": int(rule.cooldown_minutes or 0),
        "owner": {
            "id": str(rule.owner_id) if rule.owner_id else None,
            "name": owner.full_name if owner else None,
        },
        "last_triggered_at": iso(rule.last_triggered_at),
        "trigger_count": int(rule.trigger_count or 0),
        "last_match_count": int(rule.last_match_count or 0),
        "created_at": iso(rule.created_at),
        "updated_at": iso(rule.updated_at),
        # Sent rather than inferred in the browser, because the reason a
        # control is absent is a fact the server holds (§76).
        "can_edit": _can_edit(rule, principal),
    }


def _can_edit(rule: AlertRule, principal) -> bool:
    if not rule.owner_id:
        return True
    return rule.owner_id == getattr(principal, "user_id", None) or principal.can("admin.access")


def serialize_run(run: AlertRuleRun) -> dict[str, Any]:
    detail = run.detail if isinstance(run.detail, dict) else {}
    return {
        "id": str(run.id),
        "rule_id": str(run.rule_id),
        "dry_run": bool(run.dry_run),
        "started_at": iso(run.started_at),
        "finished_at": iso(run.finished_at),
        "matched": int(run.matched or 0),
        "fired": int(run.fired or 0),
        "suppressed": int(run.suppressed or 0),
        "deferred": int(run.deferred or 0),
        "error": run.error,
        "capped": bool(detail.get("capped")),
        "sample": detail.get("sample") or [],
        "by_action": detail.get("by_action") or {},
        "triggered_by": run.triggered_by.full_name if run.triggered_by else None,
    }


def _audit_state(rule: AlertRule) -> dict[str, Any]:
    """What an audit entry keeps of a rule: the parts somebody argues about."""
    return {
        "name": rule.name,
        "resource_type": rule.resource_type,
        "enabled": bool(rule.enabled),
        "severity": rule.severity,
        "condition_text": rule.condition_text,
        "actions": rule.actions or [],
        "schedule": rule.schedule,
        "cooldown_minutes": int(rule.cooldown_minutes or 0),
    }


# ── References for the things actions create ─────────────────────────────


def _next_task_reference(session) -> str:
    """The next `TSK-00042`, counted the way the task service counts it."""
    latest = session.scalar(
        select(func.max(Task.reference)).where(Task.reference.like("TSK-%"))
    )
    return identifier("TSK", sequence_of(latest, prefix="TSK") + 1)


def _next_message_ref(session) -> str:
    latest = session.scalar(
        select(func.max(EmailMessage.message_ref)).where(EmailMessage.message_ref.like("AUTO-%"))
    )
    return identifier("AUTO", sequence_of(latest, prefix="AUTO") + 1, width=6)
