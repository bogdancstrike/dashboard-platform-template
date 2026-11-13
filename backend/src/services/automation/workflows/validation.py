"""A rule's payload, checked; and the ownership checks every write makes."""

from __future__ import annotations

from typing import Any

from src.core.errors import ForbiddenError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.core.rules import compile_tree, describe_tree
from src.models.platform import AlertRule
from src.services.automation.graph.cleaning import clean_action
from src.services.automation.graph.cron import _schedule_fields as _cron
from src.services.automation.workflows.actions import SEVERITIES
from src.services.automation.workflows.registry import FORM_ACTIONS
from src.services.records.explorer import resource_for


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
        cleaned.append(clean_action(session, entry, resource))
    return cleaned



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
