"""Saved reports (§28).

A report is a *saved analysis*: which dataset, grouped by what, measured how,
filtered how, over which period, drawn as what. Running one is not a second
query engine — it hands the stored definition to `services/analysis.py`, the
same compiler the analytics workspace and both builders use. A report that
computed its numbers differently from the screen it was built on would be a
report nobody could reconcile with the screen it was built on.

Sharing is `core/sharing`, exactly as saved searches use it: private by
default, shared with named members, public, and only the owner writes. The
requirement is explicit — one mechanism, one table, one set of rules — so
adopting it here costs a single string (`KIND`) rather than a second set of
visibility bugs.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core import audit, sharing
from src.core.clock import iso, now
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.models.personal import Report
from src.services import analysis
from src.services import favorites
from src.services.explorer import resource_for

#: The polymorphic key reports share under.
KIND = "report"

#: Building and saving a report is its own privilege; reading one is not.
MANAGE_PERMISSION = "reports.manage"
VIEW_PERMISSION = "reports.view"
#: Publishing somebody else's reading material is a third thing again, and it
#: is the same permission saved searches use — one answer to "who may share".
SHARE_PERMISSION = "searches.share"

#: How a saved analysis may be drawn. Every one of these is a kind the chart
#: renderer already themes, so a saved report cannot name a picture the
#: platform has no way to paint.
VISUALIZATIONS = frozenset({
    "bar", "hbar", "line", "area", "pie", "multi-line", "stacked-area",
    "stacked-bar", "stacked-hbar", "treemap", "funnel", "scatter", "heatmap",
    "radar", "gauge", "table",
})


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


def definition(row: Report) -> dict[str, Any]:
    """The analysis payload a stored report stands for."""
    return {
        "resource_type": row.resource_type,
        "dimensions": _stored_dimensions(row),
        "measures": _stored_measures(row),
        "filters": row.filters or {},
        "condition_tree": row.condition_tree,
        "period": row.period or "all_time",
    }


def _stored_dimensions(row: Report) -> list[dict[str, str]]:
    """`["status", "placed_at:month"]` → the compiler's dimension objects.

    Stored as strings because the column is a text array, and a JSON blob for
    two fields would be a column nobody can index or read in psql.
    """
    out: list[dict[str, str]] = []
    for entry in row.dimensions or []:
        field, _, granularity = str(entry).partition(":")
        out.append({"field": field, "granularity": granularity})
    return out


def _stored_measures(row: Report) -> list[dict[str, str]]:
    """`["count", "sum:total"]` → the compiler's measure objects."""
    out: list[dict[str, str]] = []
    for entry in row.metrics or []:
        aggregation, _, field = str(entry).partition(":")
        out.append({"aggregation": aggregation, "field": field})
    return out


# ── validation ───────────────────────────────────────────────────────────


def _validated(
    payload: Any, *, principal, partial: bool, existing: Report | None = None,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("The report must be a JSON object.")
    allowed = {
        "name", "description", "resource_type", "scope", "member_ids",
        "dimensions", "metrics", "filters", "condition_tree", "group_by",
        "sort", "order", "period", "visualization", "is_favorite", "schedule",
    }
    unknown = set(payload) - allowed
    if unknown:
        raise ValidationError("Unknown report field.", details={"fields": sorted(unknown)})

    resource = resource_for(
        payload.get("resource_type", existing.resource_type if existing else None),
        principal=principal,
    )
    out: dict[str, Any] = {}

    if not partial or "name" in payload:
        name = " ".join(str(payload.get("name") or "").split())
        if not name or len(name) > 200:
            raise ValidationError(
                "name must contain 1 to 200 characters", details={"field": "name"},
            )
        out["name"] = name

    if "description" in payload:
        out["description"] = (str(payload["description"] or "").strip() or None)

    if not partial or "resource_type" in payload:
        out["resource_type"] = resource.key

    changing = existing is None or str(payload.get("scope", existing.scope)).upper() != existing.scope
    scope = sharing.scope_of(
        payload.get("scope", existing.scope if existing else "PRIVATE"),
        principal=principal if changing else None,
        share_permission=SHARE_PERMISSION,
    )
    if not partial or "scope" in payload:
        out["scope"] = scope

    if not partial or "dimensions" in payload:
        out["dimensions"] = _dimensions(payload.get("dimensions") or [])
    if not partial or "metrics" in payload:
        out["metrics"] = _metrics(payload.get("metrics") or [])

    if "filters" in payload:
        filters = payload["filters"] or {}
        if not isinstance(filters, dict):
            raise ValidationError("filters must be an object.")
        out["filters"] = filters
    if "condition_tree" in payload:
        tree = payload["condition_tree"]
        if tree is not None and not isinstance(tree, dict):
            raise ValidationError("condition_tree must be an object or null.")
        out["condition_tree"] = tree

    if not partial or "period" in payload:
        # Validated by the same function that will resolve it at run time, so
        # a report cannot be saved with a period the compiler would refuse.
        period = payload.get("period", existing.period if existing else "last_30_days")
        analysis.period_window(period)
        out["period"] = period

    if not partial or "visualization" in payload:
        visualization = str(
            payload.get("visualization", existing.visualization if existing else "bar")
        ).strip().lower()
        if visualization not in VISUALIZATIONS:
            raise ValidationError(
                "Unknown visualization.",
                details={"visualization": visualization, "allowed": sorted(VISUALIZATIONS)},
            )
        out["visualization"] = visualization

    if "sort" in payload:
        out["sort"] = str(payload["sort"] or "").strip() or None
    if "order" in payload:
        order = str(payload["order"] or "desc").lower()
        if order not in ("asc", "desc"):
            raise ValidationError("order must be asc or desc", details={"field": "order"})
        out["order"] = order
    if "schedule" in payload:
        out["schedule"] = str(payload["schedule"] or "").strip() or None
    # `is_favorite` is deliberately *not* here: it is no longer a column this
    # writes. See `_apply_favorite`, which puts it in the one store (§38).

    if "member_ids" in payload or not partial:
        wanted = sharing.requested_members(payload)
        if wanted:
            principal.require(SHARE_PERMISSION)
        out["member_ids"] = wanted

    return out


def _dimensions(raw: Any) -> list[str]:
    """`[{"field": "placed_at", "granularity": "month"}]` → `["placed_at:month"]`."""
    if not isinstance(raw, (list, tuple)):
        raise ValidationError("dimensions must be an array.")
    if len(raw) > 2:
        raise ValidationError("A report groups by at most two fields.")
    out: list[str] = []
    for entry in raw:
        if isinstance(entry, str):
            out.append(entry)
            continue
        if not isinstance(entry, dict) or not entry.get("field"):
            raise ValidationError("Each dimension needs a field.")
        granularity = str(entry.get("granularity") or "")
        out.append(f"{entry['field']}:{granularity}" if granularity else str(entry["field"]))
    return out


def _metrics(raw: Any) -> list[str]:
    """`[{"aggregation": "sum", "field": "total"}]` → `["sum:total"]`."""
    if not isinstance(raw, (list, tuple)):
        raise ValidationError("metrics must be an array.")
    if len(raw) > 4:
        raise ValidationError("A report computes at most four measures.")
    out: list[str] = []
    for entry in raw:
        if isinstance(entry, str):
            out.append(entry)
            continue
        if not isinstance(entry, dict):
            raise ValidationError("Each metric must be an object or a string.")
        aggregation = str(entry.get("aggregation") or entry.get("kind") or "count").lower()
        field = str(entry.get("field") or "")
        out.append(f"{aggregation}:{field}" if field else aggregation)
    return out or ["count"]


# ── loading ──────────────────────────────────────────────────────────────


def _visible(session, report_id: Any, principal) -> Report:
    principal.require(VIEW_PERMISSION)
    identifier = parse_uuid(report_id, field="report_id")
    row = session.scalars(
        select(Report)
        .options(selectinload(Report.owner))
        .where(
            Report.id == identifier,
            Report.deleted_at.is_(None),
            sharing.visibility(Report, KIND, principal),
        )
    ).unique().one_or_none()
    if row is None:
        # The same answer as "you may not see it": whether a private report
        # exists is itself information (§76).
        raise NotFoundError("That report does not exist or is private.")
    return row


def _owned(session, report_id: Any, principal) -> Report:
    row = _visible(session, report_id, principal)
    sharing.require_owner(row, principal, kind="report")
    return row


def _apply_favorite(session, row: Report, payload: Any, *, principal) -> None:
    """Star or unstar this report, if the payload said anything about it.

    Separate from `_validated` because it is not a *field of the report*: a
    star is a fact about a reader, and two readers can disagree about the same
    report. Writing it into a column on the report was the old design, and it
    is why the reports page and `/favorites` gave different answers to "what
    have I starred" (§38).
    """
    body = payload if isinstance(payload, dict) else {}
    if "is_favorite" not in body:
        return
    favorites.set_favorite(
        session,
        principal,
        resource_type=KIND,
        resource_id=row.id,
        label=row.name,
        url=f"/reports/{row.id}",
        icon="bar-chart",
        wanted=bool(body["is_favorite"]),
    )


def _serialize(
    session, row: Report, principal, *, starred: set[str] | None = None
) -> dict[str, Any]:
    """One report as a reader sees it.

    `starred` is the whole page's stars, fetched once by `listing`. Passing it
    is not an optimisation to reach for later: without it, serialising
    twenty-five reports is twenty-five extra queries.
    """
    return {
        "id": str(row.id),
        "name": row.name,
        "description": row.description,
        "resource_type": row.resource_type,
        "scope": row.scope,
        "owner": {
            "id": str(row.owner_id) if row.owner_id else "",
            "name": row.owner.full_name if row.owner else "Former user",
            "email": row.owner.email if row.owner else None,
        },
        "can_edit": row.owner_id == principal.user_id and principal.can(MANAGE_PERMISSION),
        "members": sharing.members(session, KIND, row.id),
        "dimensions": _stored_dimensions(row),
        "metrics": _stored_measures(row),
        "filters": row.filters or {},
        "condition_tree": row.condition_tree,
        "period": row.period,
        "visualization": row.visualization,
        "sort": row.sort,
        "order": row.order,
        "schedule": row.schedule,
        # From `favorites`, not from the column. The field stays in the API
        # because the page is built on it; what changed is where the answer
        # comes from.
        "is_favorite": (
            str(row.id) in starred
            if starred is not None
            else favorites.is_favorite_of(
                session, principal, resource_type=KIND, resource_id=row.id
            )
        ),
        "run_count": row.run_count,
        "last_run_at": iso(row.last_run_at),
        "created_at": iso(row.created_at),
        "updated_at": iso(row.updated_at),
    }


def _state(row: Report) -> dict[str, Any]:
    return {
        "name": row.name, "description": row.description,
        "resource_type": row.resource_type, "scope": row.scope,
        "dimensions": list(row.dimensions or []), "metrics": list(row.metrics or []),
        "filters": row.filters, "condition_tree": row.condition_tree,
        "period": row.period, "visualization": row.visualization,
        # Not `is_favorite`: an audit diff records what *the report* changed,
        # and starring one is a fact about a reader rather than about it.
        "schedule": row.schedule,
    }
