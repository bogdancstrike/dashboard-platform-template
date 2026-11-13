"""The action registry (strategy table) and what the editor is told about it."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.core.rules import MAX_RULES
from src.core.vocabulary import PRIORITY
from src.services.automation.graph.kinds import catalogue_extras
from src.services.automation.workflows.actions import PERMISSION, SEVERITIES, Action
from src.services.automation.workflows.matching import MAX_FIRES, MAX_MATCHES
from src.services.automation.workflows.messages import _email, _notify
from src.services.automation.workflows.record_actions import (
    _assign,
    _create_record,
    _task,
    _update_field,
)
from src.services.automation.workflows.webhook import _webhook
from src.services.records.explorer import resources

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
        **catalogue_extras(session),
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
