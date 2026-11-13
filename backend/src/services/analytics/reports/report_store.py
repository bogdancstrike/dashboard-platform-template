"""Reports: list, read, create, change, remove, duplicate, run."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core import audit, sharing
from src.core.clock import now
from src.models.personal import Report
from src.services.analytics import analysis
from src.services.analytics.reports.access import (
    KIND,
    MANAGE_PERMISSION,
    SHARE_PERMISSION,
    VIEW_PERMISSION,
    VISUALIZATIONS,
    _apply_favorite,
    _owned,
    _serialize,
    _state,
    _visible,
)
from src.services.analytics.reports.validation import _validated, definition
from src.services.records import favorites
from src.services.records.explorer import resource_for


def listing(session, args, *, principal) -> dict[str, Any]:
    """Every report this reader may open, theirs first."""
    principal.require(VIEW_PERMISSION)
    statement = (
        select(Report)
        .options(selectinload(Report.owner))
        .where(Report.deleted_at.is_(None), sharing.visibility(Report, KIND, principal))
        .order_by(Report.updated_at.desc(), Report.name.asc())
    )
    resource_type = str((args or {}).get("resource_type") or "").strip()
    if resource_type:
        resource_for(resource_type, principal=principal)
        statement = statement.where(Report.resource_type == resource_type)

    rows = session.scalars(statement).unique().all()
    # One query for the whole page's stars, then sorted here: `is_favorite`
    # lives in `favorites` now (§38), so ordering by a column that no longer
    # holds the answer would put nothing first. A lookup per row would be
    # twenty-six queries for twenty-five reports.
    starred = favorites.favorite_ids(session, principal, resource_type=KIND)
    rows = sorted(
        rows,
        key=lambda row: (str(row.id) not in starred, row.updated_at is None),
    )
    sharing.prefetch_members(session, KIND, [row.id for row in rows])
    return {
        "items": [_serialize(session, row, principal, starred=starred) for row in rows],
        "total": len(rows),
        "visualizations": sorted(VISUALIZATIONS),
        "can_create": principal.can(MANAGE_PERMISSION),
        "can_share": principal.can(SHARE_PERMISSION),
    }


def get(session, report_id: Any, *, principal) -> dict[str, Any]:
    return _serialize(session, _visible(session, report_id, principal), principal)


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    values = _validated(payload, principal=principal, partial=False)
    members = values.pop("member_ids")
    row = Report(owner_id=principal.user_id, organization_id=principal.organization_id, **values)
    session.add(row)
    session.flush()
    sharing.replace_members(
        session, KIND, row.id, members, principal=principal, owner_id=row.owner_id,
    )
    _apply_favorite(session, row, payload, principal=principal)
    audit.record(
        session, action="CREATE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal, after=_state(row),
        message=f"created report {row.name}", activity=False,
    )
    return _serialize(session, row, principal)


def update(session, report_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    row = _owned(session, report_id, principal)
    values = _validated(payload, principal=principal, partial=True, existing=row)
    members = values.pop("member_ids", None)
    before = _state(row)
    for key, value in values.items():
        setattr(row, key, value)
    if members is not None:
        sharing.replace_members(
            session, KIND, row.id, members, principal=principal, owner_id=row.owner_id,
        )
    session.flush()
    _apply_favorite(session, row, payload, principal=principal)
    audit.record(
        session,
        action="SHARE" if "scope" in values or members is not None else "UPDATE",
        resource_type=KIND, resource_id=row.id, resource_label=row.name,
        principal=principal, before=before, after=_state(row),
        message=f"updated report {row.name}", activity=False,
    )
    return _serialize(session, row, principal)


def remove(session, report_id: Any, *, principal) -> None:
    principal.require(MANAGE_PERMISSION)
    row = _owned(session, report_id, principal)
    before = _state(row)
    row.deleted_at = now()
    audit.record(
        session, action="DELETE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal, before=before,
        message=f"deleted report {row.name}", activity=False,
    )


def duplicate(session, report_id: Any, *, principal) -> dict[str, Any]:
    """A member's own copy of somebody else's report.

    The way a reader who is not the owner gets a version they can change —
    which is what keeps "only the owner writes" from being a dead end.
    """
    principal.require(MANAGE_PERMISSION)
    source = _visible(session, report_id, principal)
    row = Report(
        name=f"{source.name} (copy)"[:200], description=source.description,
        resource_type=source.resource_type, owner_id=principal.user_id,
        organization_id=principal.organization_id, scope="PRIVATE",
        dimensions=list(source.dimensions or []), metrics=list(source.metrics or []),
        filters=source.filters, condition_tree=source.condition_tree,
        group_by=source.group_by, sort=source.sort, order=source.order,
        period=source.period, visualization=source.visualization,
        is_favorite=False, run_count=0,
    )
    session.add(row)
    session.flush()
    audit.record(
        session, action="CREATE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal, after=_state(row),
        metadata={"duplicated_from": str(source.id)},
        message=f"duplicated report {source.name}", activity=False,
    )
    return _serialize(session, row, principal)


def run(session, report_id: Any, overrides: dict[str, Any] | None = None, *, principal) -> dict[str, Any]:
    """Execute a saved report through the shared analysis compiler.

    The stored definition is the input, not a second implementation: whatever
    the workspace would have computed for the same question is what a report
    of that question returns.
    """
    row = _visible(session, report_id, principal)
    row.run_count = int(row.run_count or 0) + 1
    row.last_run_at = now()
    session.flush()
    result = analysis.run(session, {**definition(row), **(overrides or {})}, principal=principal)
    return {"report": _serialize(session, row, principal), "result": result}
