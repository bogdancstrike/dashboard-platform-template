"""Which records a rule matches now, and the cooldown that keeps one record from firing twice."""

from __future__ import annotations

import urllib.request
from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.core.rules import compile_tree
from src.models.platform import AlertRule, AlertRuleFire
from src.services.automation.workflows.actions import Match
from src.services.records.explorer import resource_for

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
