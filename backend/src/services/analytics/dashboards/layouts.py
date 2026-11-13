"""Listing, creating, changing and removing dashboards."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core import audit, sharing
from src.core.clock import now
from src.models.personal import Dashboard, DashboardWidget
from src.services.analytics.dashboards.copies import _requested_widgets
from src.services.analytics.dashboards.serializers import (
    _make_home,
    _owned,
    _serialize,
    _slug,
    _state,
    _visible,
)
from src.services.analytics.dashboards.validation import _validated
from src.services.analytics.dashboards.widget_catalogue import (
    KIND,
    MANAGE_PERMISSION,
    SHARE_PERMISSION,
    _offerable,
)
from src.services.analytics.dashboards.widget_sizes import COLUMNS
from src.services.records.explorer import resources


def listing(session, *, principal) -> dict[str, Any]:
    """Every dashboard this reader may open, their own first."""
    rows = session.scalars(
        select(Dashboard)
        .options(selectinload(Dashboard.owner), selectinload(Dashboard.widgets))
        .where(Dashboard.deleted_at.is_(None), sharing.visibility(Dashboard, KIND, principal))
        .order_by(Dashboard.is_home.desc(), Dashboard.updated_at.desc(), Dashboard.name.asc())
    ).unique().all()

    sharing.prefetch_members(session, KIND, [row.id for row in rows])
    return {
        "items": [_serialize(session, row, principal, widgets=False) for row in rows],
        "total": len(rows),
        # Only the kinds this reader could actually see answered. A module
        # widget is gated on the permission that gates the page it mirrors, so
        # somebody without `mail.access` is not offered a Mail card that would
        # draw a 403 the moment it landed on the grid (§76).
        "widget_kinds": sorted(_offerable(principal)),
        "columns": COLUMNS,
        # The datasets a widget may point at, so the builder cannot offer one
        # this reader may not read.
        "datasets": [
            {"key": resource.key, "label": resource.label, "path": resource.path}
            for resource in resources().values()
            if principal.can(resource.permission)
        ],
        "can_create": principal.can(MANAGE_PERMISSION),
        "can_share": principal.can(SHARE_PERMISSION),
    }


def get(session, dashboard_id: Any, *, principal) -> dict[str, Any]:
    return _serialize(session, _visible(session, dashboard_id, principal), principal)


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """A dashboard, and whatever it was asked to start with.

    Widgets arrive with it rather than one request at a time, because a
    dashboard is created *in order to hold* something: an empty one is a thing
    somebody then has to furnish, and a create flow that ends on an empty grid
    has stopped one step short. They are laid out here by the same rule the
    grid's own compaction uses, so the result is tidy without anybody dragging.
    """
    principal.require(MANAGE_PERMISSION)
    values = _validated(payload, principal=principal, partial=False)
    members = values.pop("member_ids")
    home = values.pop("is_home", False)
    wanted = _requested_widgets(payload, principal=principal)

    row = Dashboard(
        owner_id=principal.user_id,
        organization_id=principal.organization_id,
        slug=_slug(values["name"]),
        **values,
    )
    session.add(row)
    session.flush()
    for position, widget in enumerate(wanted):
        row.widgets.append(DashboardWidget(position=position, **widget))
    session.flush()
    if home:
        _make_home(session, row, principal)
    sharing.replace_members(
        session, KIND, row.id, members, principal=principal, owner_id=row.owner_id,
    )
    audit.record(
        session, action="CREATE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal, after=_state(row),
        message=f"created dashboard {row.name}", activity=False,
    )
    return _serialize(session, row, principal)


def update(session, dashboard_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    row = _owned(session, dashboard_id, principal)
    values = _validated(payload, principal=principal, partial=True, existing=row)
    members = values.pop("member_ids", None)
    home = values.pop("is_home", None)
    before = _state(row)

    for key, value in values.items():
        setattr(row, key, value)
    if home is not None:
        if home:
            _make_home(session, row, principal)
        else:
            row.is_home = False
    if members is not None:
        sharing.replace_members(
            session, KIND, row.id, members, principal=principal, owner_id=row.owner_id,
        )
    session.flush()
    audit.record(
        session,
        action="SHARE" if "scope" in values or members is not None else "UPDATE",
        resource_type=KIND, resource_id=row.id, resource_label=row.name,
        principal=principal, before=before, after=_state(row),
        message=f"updated dashboard {row.name}", activity=False,
    )
    return _serialize(session, row, principal)


def remove(session, dashboard_id: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    row = _owned(session, dashboard_id, principal)
    before = _state(row)
    row.deleted_at = now()
    audit.record(
        session, action="DELETE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal, before=before,
        message=f"deleted dashboard {row.name}", activity=False,
    )
    # The id and the name, so the caller can say what went rather than only
    # that something did.
    return {"id": str(row.id), "deleted": True, "name": row.name}
