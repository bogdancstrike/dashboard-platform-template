"""Who sees a dashboard, and a dashboard as the API returns it."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy import update as sql_update
from sqlalchemy.orm import selectinload

from src.core import sharing
from src.core.errors import NotFoundError
from src.core.pagination import parse_uuid
from src.models.personal import Dashboard, DashboardWidget
from src.services.analytics.dashboards.widget_catalogue import KIND, MANAGE_PERMISSION
from src.services.analytics.dashboards.widget_sizes import COLUMNS


def _make_home(session, row: Dashboard, principal) -> None:
    """This one, and only this one (§67)."""
    session.execute(
        sql_update(Dashboard)
        .where(Dashboard.owner_id == principal.user_id, Dashboard.id != row.id)
        .values(is_home=False)
    )
    row.is_home = True


def _visible(session, dashboard_id: Any, principal) -> Dashboard:
    identifier = parse_uuid(dashboard_id, field="dashboard_id")
    row = session.scalars(
        select(Dashboard)
        .options(selectinload(Dashboard.owner), selectinload(Dashboard.widgets))
        .where(
            Dashboard.id == identifier,
            Dashboard.deleted_at.is_(None),
            sharing.visibility(Dashboard, KIND, principal),
        )
    ).unique().first()
    if row is None:
        # The same answer as "you may not see it": whether somebody else's
        # private dashboard exists is itself information (§76).
        raise NotFoundError("That dashboard does not exist.", details={"id": str(identifier)})
    return row


def _owned(session, dashboard_id: Any, principal) -> Dashboard:
    row = _visible(session, dashboard_id, principal)
    sharing.require_owner(row, principal, kind=KIND)
    return row


def _widget_of(row: Dashboard, widget_id: Any) -> DashboardWidget:
    identifier = str(parse_uuid(widget_id, field="widget_id"))
    for widget in row.widgets:
        if str(widget.id) == identifier:
            return widget
    raise NotFoundError(
        "That widget is not on this dashboard.",
        details={"widget_id": identifier, "dashboard": str(row.id)},
    )


def _slug(name: str) -> str:
    cleaned = "".join(character if character.isalnum() else "-" for character in name.lower())
    return "-".join(part for part in cleaned.split("-") if part)[:120] or "dashboard"


def _serialize(session, row: Dashboard, principal, *, widgets: bool = True) -> dict[str, Any]:
    owner = row.owner
    can_edit = row.owner_id == principal.user_id and principal.can(MANAGE_PERMISSION)
    out: dict[str, Any] = {
        "id": str(row.id),
        "name": row.name,
        "slug": row.slug,
        "description": row.description,
        "scope": row.scope,
        "icon": row.icon,
        # *This reader's* home, not the owner's (§67). The column records a
        # preference belonging to whoever owns the dashboard, and publishing it
        # raw put a home marker on a colleague's public dashboard — which told
        # the reader something false about their own settings.
        "is_home": bool(row.is_home) and row.owner_id == principal.user_id,
        "is_default": bool(row.is_default),
        "columns": row.columns or COLUMNS,
        "filters": row.filters or {},
        "owner": {
            "id": str(owner.id) if owner else "",
            "name": owner.full_name if owner else "",
            "email": owner.email if owner else None,
        },
        "can_edit": can_edit,
        "members": sharing.members(session, KIND, row.id) if can_edit else [],
        "widget_count": len(row.widgets),
        # *What* it holds, not only how much — a card in a gallery has room for
        # the kinds and a reader recognises "alerts, revenue, a heatmap" far
        # faster than "7 widgets".
        "widget_kinds": sorted({widget.kind for widget in row.widgets}),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
    if widgets:
        out["widgets"] = [_widget(widget) for widget in sorted(
            row.widgets, key=lambda item: (item.position, item.y, item.x)
        )]
    return out


def _widget(row: DashboardWidget) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "kind": row.kind,
        "title": row.title,
        "subtitle": row.subtitle,
        "x": row.x,
        "y": row.y,
        "width": row.width,
        "height": row.height,
        "position": row.position,
        "config": row.config or {},
    }


def _state(row: Dashboard) -> dict[str, Any]:
    return {
        "name": row.name,
        "scope": row.scope,
        "is_home": bool(row.is_home),
        "columns": row.columns,
        "widgets": len(row.widgets),
    }
