"""Restoring a version, creating a rule with its graph, and keeping form edits in step."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.core.errors import NotFoundError, ValidationError
from src.models.automation_graphs import AutomationGraph, AutomationVersion
from src.models.platform import AlertRule
from src.services.automation.graph.checks import problems
from src.services.automation.graph.legacy import apply_form_edit, linear
from src.services.automation.graph.shape import PERMISSION, normalize
from src.services.automation.graph.storage import (
    _install,
    _require_own,
    _rule,
    detail,
    ensure,
)


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
