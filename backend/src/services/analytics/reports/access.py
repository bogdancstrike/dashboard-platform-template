"""Report permissions and visualisations, who sees a report, and a report as the API returns it."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core import sharing
from src.core.clock import iso
from src.core.errors import NotFoundError
from src.core.pagination import parse_uuid
from src.models.personal import Report
from src.services.analytics.reports.serializers import (
    _stored_dimensions,
    _stored_measures,
)
from src.services.records import favorites

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
