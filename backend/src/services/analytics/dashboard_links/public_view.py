"""The public side: rate limits, unlocking and viewing."""

from __future__ import annotations

from typing import Any

from werkzeug.security import check_password_hash

from src.core.clock import now
from src.core.errors import ForbiddenError, UnauthorizedError, ValidationError
from src.services.analytics.dashboard_links.answers import (
    _answer,
    _live_link,
    _owner_principal,
)
from src.services.analytics.dashboard_links.link_state import (
    GRANT_SECONDS,
    UNLOCK_LIMIT,
    VIEW_LIMIT,
    _object,
    _origin,
)
from src.services.analytics.dashboard_links.rate_limits import (
    _granted,
    _limit,
    _serializer,
)


def unlock(session, token: str, payload: dict[str, Any], *, client: str) -> dict[str, Any]:
    _limit(f"unlock:{token}:{client}", limit=UNLOCK_LIMIT, window=600)
    row = _live_link(session, token)
    if not row.password_hash:
        return {"grant": None, "expires_in": None}
    password = str(_object(payload).get("password") or "")
    if not password or not check_password_hash(row.password_hash, password):
        raise UnauthorizedError("That password is not right.", details={"reason": "wrong_password"})
    grant = _serializer().dumps({"link": str(row.id), "v": int(row.password_version or 0)})
    return {"grant": grant, "expires_in": GRANT_SECONDS}


def _embed_allowed(row, origin: str | None) -> bool:
    if not origin:
        return True
    if not row.allow_embed:
        return False
    allowed = list(row.allowed_origins or [])
    if not allowed:
        return True
    try:
        return _origin(origin) in allowed
    except ValidationError:
        return False


def view(session, token: str, *, grant: str | None, client: str, embed_origin: str | None) -> dict[str, Any]:
    """The dashboard as a public reader sees it, every widget already answered."""
    _limit(f"view:{token}:{client}", limit=VIEW_LIMIT, window=60)
    row = _live_link(session, token)
    if embed_origin is not None and not _embed_allowed(row, embed_origin):
        raise ForbiddenError("This dashboard may not be embedded here.",
                             details={"reason": "origin_not_allowed", "origin": embed_origin})
    if not _granted(row, grant):
        raise UnauthorizedError("This dashboard is protected by a password.",
                                details={"reason": "password_required"})
    dashboard = row.dashboard
    owner = _owner_principal(session, dashboard.owner_id)
    period = str((dashboard.filters or {}).get("period") or "last_30_days")
    widgets = []
    for widget in sorted(dashboard.widgets, key=lambda w: (w.position, w.y, w.x)):
        widgets.append({
            "id": str(widget.id), "kind": widget.kind, "title": widget.title, "subtitle": widget.subtitle,
            "x": widget.x, "y": widget.y, "width": widget.width, "height": widget.height,
            "data": _answer(session, widget, owner, period),
        })
    row.view_count = int(row.view_count or 0) + 1
    row.last_viewed_at = now()
    session.flush()
    return {
        "dashboard": {
            "name": dashboard.name, "description": dashboard.description, "icon": dashboard.icon,
            "columns": dashboard.columns or 12, "period": period,
            "owner": dashboard.owner.full_name if dashboard.owner else None,
            "updated_at": dashboard.updated_at.isoformat() if dashboard.updated_at else None,
        },
        "widgets": widgets,
        "link": {"label": row.label, "expires_at": row.expires_at.isoformat() if row.expires_at else None,
                 "embedded": embed_origin is not None},
        "generated_at": now().isoformat(),
    }
