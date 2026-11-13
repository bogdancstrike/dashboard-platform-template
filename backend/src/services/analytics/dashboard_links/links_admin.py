"""Public dashboard links: limits, list, create, change, revoke."""

from __future__ import annotations

import secrets
from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.clock import now
from src.core.errors import ValidationError
from src.services.analytics.dashboard_links.link_state import (
    MANAGE,
    PUBLISH,
    _apply,
    _audit_state,
    _link,
    _link_dict,
    _object,
    _owned_dashboard,
)


def links(session, dashboard_id: Any, *, principal) -> dict[str, Any]:
    from src.models.records_analytics import DashboardLink

    principal.require(MANAGE)
    dashboard = _owned_dashboard(session, dashboard_id, principal)
    rows = session.scalars(
        select(DashboardLink).where(DashboardLink.dashboard_id == dashboard.id)
        .order_by(DashboardLink.created_at.desc())
    ).all()
    return {
        "items": [_link_dict(row) for row in rows],
        "can_publish": principal.can(PUBLISH),
        "dashboard": {"id": str(dashboard.id), "name": dashboard.name},
    }


def create(session, dashboard_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.records_analytics import DashboardLink

    principal.require(MANAGE, PUBLISH)
    dashboard = _owned_dashboard(session, dashboard_id, principal)
    body = _object(payload)
    row = DashboardLink(
        dashboard_id=dashboard.id, token=secrets.token_urlsafe(32), created_by_id=principal.user_id,
        view_count=0, password_version=0, allow_embed=False,
    )
    _apply(row, body, creating=True)
    session.add(row)
    session.flush()
    audit.record(session, action="SHARE", resource_type="dashboard", resource_id=dashboard.id,
                 resource_label=dashboard.name, principal=principal,
                 after=_audit_state(row), message=f"published a public link to {dashboard.name}")
    return _link_dict(row)


def update(session, dashboard_id: Any, link_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(MANAGE, PUBLISH)
    dashboard = _owned_dashboard(session, dashboard_id, principal)
    row = _link(session, dashboard.id, link_id)
    if row.revoked_at is not None:
        raise ValidationError("A revoked link cannot be changed — publish a new one.")
    before = _audit_state(row)
    _apply(row, _object(payload), creating=False)
    session.flush()
    audit.record(session, action="SHARE", resource_type="dashboard", resource_id=dashboard.id,
                 resource_label=dashboard.name, principal=principal, before=before,
                 after=_audit_state(row), message=f"changed a public link to {dashboard.name}")
    return _link_dict(row)


def revoke(session, dashboard_id: Any, link_id: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    dashboard = _owned_dashboard(session, dashboard_id, principal)
    row = _link(session, dashboard.id, link_id)
    if row.revoked_at is None:
        row.revoked_at = now()
        session.flush()
        audit.record(session, action="SHARE", resource_type="dashboard", resource_id=dashboard.id,
                     resource_label=dashboard.name, principal=principal,
                     before={"revoked": False}, after={"revoked": True},
                     message=f"revoked a public link to {dashboard.name}")
    return _link_dict(row)
