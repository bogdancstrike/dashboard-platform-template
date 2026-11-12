"""Seeded insights (§43): a few saved pages, and one on a dashboard.

Built from the hand-written suggestions and bound against the seeded records,
exactly as pressing a suggestion and saving it would — no model involved.
`--sync-insights` adds what is missing to a running database.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, select

from src.core.clock import now

#: (owner, suggestion key, scope, pinned, days ago)
SAVED = (
    ("admin", "order-1", "PUBLIC", True, 6),
    ("admin", "ticket-1", "PRIVATE", True, 4),
    ("admin", "project-1", "PRIVATE", False, 2),
    ("manager", "customer-1", "PUBLIC", False, 5),
    ("manager", "order-2", "PRIVATE", True, 1),
)


def _principal(user):
    from src.core.auth import ROLE_DEFAULTS, Principal

    code = "MANAGER" if user.username == "manager" else "ADMINISTRATOR"
    return Principal(user_id=user.id, subject="", email=user.email or "", username=user.username,
                     full_name=user.full_name, role_code=code,
                     permissions=frozenset(ROLE_DEFAULTS[code]["permissions"]),
                     organization_id=user.organization_id)


def seed(session) -> dict[str, int]:
    from src.models.identity import User
    from src.models.insights import Insight
    from src.models.personal import Dashboard, DashboardWidget
    from src.services import insight_spec as specs
    from src.services import insight_suggestions as suggestions

    users = {u.username: u for u in session.scalars(select(User).where(User.username.in_(("admin", "manager"))))}
    made = 0
    first_admin: Any = None
    for username, key, scope, pinned, days in SAVED:
        user = users.get(username)
        item = suggestions.find(key)
        if user is None or item is None:
            continue
        existing = session.scalars(select(Insight).where(
            Insight.owner_id == user.id, Insight.question == item["question"], Insight.deleted_at.is_(None))).first()
        if existing is not None:
            first_admin = first_admin or (existing if username == "admin" else None)
            continue
        spec, _dropped = specs.validate(item["spec"])
        rendered, errors = specs.bind(session, spec, principal=_principal(user))
        when = now() - timedelta(days=days, hours=3)
        row = Insight(title=spec["title"], question=item["question"], summary=spec["summary"] or None,
                      datasets=specs.queries_of(spec), spec=spec, rendered=rendered, warnings=errors or None,
                      source="suggested", scope=scope, pinned=pinned, refreshed_at=when,
                      owner_id=user.id, organization_id=user.organization_id, created_at=when, updated_at=when)
        session.add(row)
        session.flush()
        made += 1
        if username == "admin" and first_admin is None:
            first_admin = row

    widgets = 0
    admin = users.get("admin")
    if admin is not None and first_admin is not None:
        # The admin's default dashboard, where an insight widget is seen first.
        dashboard = session.scalars(
            select(Dashboard).where(Dashboard.owner_id == admin.id, Dashboard.deleted_at.is_(None))
            .order_by(Dashboard.is_default.desc(), Dashboard.created_at)
        ).first()
        if dashboard is not None and not session.scalar(select(DashboardWidget.id).where(
                DashboardWidget.dashboard_id == dashboard.id, DashboardWidget.kind == "INSIGHT")):
            bottom = session.scalar(select(func.max(DashboardWidget.y + DashboardWidget.height))
                                    .where(DashboardWidget.dashboard_id == dashboard.id)) or 0
            position = session.scalar(select(func.max(DashboardWidget.position))
                                      .where(DashboardWidget.dashboard_id == dashboard.id)) or 0
            session.add(DashboardWidget(dashboard_id=dashboard.id, kind="INSIGHT", title=first_admin.title,
                                        x=0, y=bottom, width=12, height=4, position=position + 1,
                                        config={"insight_id": str(first_admin.id)}))
            widgets = 1
    session.flush()
    return {"insights": made, "widgets": widgets}


def seed_safely(session) -> dict[str, Any]:
    """`seed` inside a savepoint, so a problem here never costs the rest of the dataset."""
    from framework.commons.logger import logger as log

    try:
        with session.begin_nested():
            return seed(session)
    except Exception as exc:  # noqa: BLE001 - the rest of the dataset must still land
        log.warning(f"seed[insights] skipped: {type(exc).__name__}: {exc} — "
                    "run 'python -m src.seed --sync-insights'", "yellow")
        return {"insights": 0, "widgets": 0, "skipped": type(exc).__name__}
