"""One walk through a graph: its state, the matched records, and the per-node log."""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field as dataclass_field
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import select

from src.core.rules import compile_tree
from src.models.platform import AlertRule, AlertRuleRun
from src.services.automation.workflows.actions import Match


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


def resource_for_principal(resource, principal) -> None:
    if principal is not None:
        principal.require(resource.permission)
