"""Link limits and permissions, applying a link's settings, and a link as the API returns it."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import select
from werkzeug.security import generate_password_hash

from src.core.clock import now
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid

MANAGE = "dashboards.manage"


PUBLISH = "dashboards.publish"


#: How long an unlock grant lasts.
GRANT_SECONDS = 12 * 3600


#: Views per address per link per minute, and password tries per ten minutes.
VIEW_LIMIT = 60


UNLOCK_LIMIT = 8


MAX_ORIGINS = 10


#: The permissions a public view resolves widgets with — reading, and nothing else.
READ_ONLY = frozenset({"records.view", "reports.view"})


#: Widgets that answer a dataset question and can therefore be published.
PUBLIC_KINDS = {
    "KPI", "GAUGE", "ANALYTICS", "LIST", "TABLE", "LINE_CHART", "AREA_CHART", "BAR_CHART",
    "PIE_CHART", "HEATMAP", "CHART", "REPORT",
}


CHART_FOR = {
    "LINE_CHART": "line", "AREA_CHART": "area", "BAR_CHART": "bar", "PIE_CHART": "pie",
    "HEATMAP": "heatmap", "CHART": "bar",
}


def _owned_dashboard(session, dashboard_id: Any, principal):
    from src.services.analytics.dashboards import _owned

    return _owned(session, dashboard_id, principal)


def _link(session, dashboard_id, link_id: Any):
    from src.models.records_analytics import DashboardLink

    row = session.scalars(
        select(DashboardLink).where(
            DashboardLink.id == parse_uuid(link_id, field="link_id"),
            DashboardLink.dashboard_id == dashboard_id,
        )
    ).first()
    if row is None:
        raise NotFoundError("That link does not exist.", details={"id": str(link_id)})
    return row


def _object(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("The request must be a JSON object.")
    return payload


def _apply(row, body: dict[str, Any], *, creating: bool) -> None:
    if "label" in body:
        row.label = (str(body.get("label") or "").strip()[:120]) or None
    if "expires_at" in body:
        raw = body.get("expires_at")
        if raw in (None, ""):
            row.expires_at = None
        else:
            try:
                moment = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            except ValueError as exc:
                raise ValidationError("expires_at must be a date or timestamp.",
                                      details={"field": "expires_at"}) from exc
            if moment.tzinfo is None:
                moment = moment.replace(tzinfo=timezone.utc)
            if moment <= now():
                raise ValidationError("A link has to expire in the future.", details={"field": "expires_at"})
            row.expires_at = moment
    if "password" in body:
        password = body.get("password")
        if password in (None, ""):
            if row.password_hash:
                row.password_version = (row.password_version or 0) + 1
            row.password_hash = None
        else:
            text = str(password)
            if len(text) < 6:
                raise ValidationError("A password needs at least 6 characters.", details={"field": "password"})
            if len(text) > 128:
                raise ValidationError("A password is at most 128 characters.", details={"field": "password"})
            row.password_hash = generate_password_hash(text)
            row.password_version = (row.password_version or 0) + 1
    if "allow_embed" in body:
        row.allow_embed = bool(body.get("allow_embed"))
    if "allowed_origins" in body:
        raw = body.get("allowed_origins") or []
        if not isinstance(raw, list):
            raise ValidationError("allowed_origins must be a list.", details={"field": "allowed_origins"})
        if len(raw) > MAX_ORIGINS:
            raise ValidationError(f"At most {MAX_ORIGINS} origins.", details={"field": "allowed_origins"})
        row.allowed_origins = [_origin(item) for item in raw if str(item).strip()]


def _origin(value: Any) -> str:
    text = str(value).strip().rstrip("/")
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.path or parsed.query:
        raise ValidationError(f"{text} is not an origin — use https://example.com.",
                              details={"field": "allowed_origins", "value": text})
    return f"{parsed.scheme}://{parsed.netloc}".lower()


def _status(row) -> str:
    if row.revoked_at is not None:
        return "REVOKED"
    if row.expires_at is not None and row.expires_at <= now():
        return "EXPIRED"
    return "ACTIVE"


def _link_dict(row) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "dashboard_id": str(row.dashboard_id),
        "token": row.token,
        "path": f"/share/dashboards/{row.token}",
        "label": row.label,
        "status": _status(row),
        "has_password": bool(row.password_hash),
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
        "allow_embed": bool(row.allow_embed),
        "allowed_origins": list(row.allowed_origins or []),
        "view_count": int(row.view_count or 0),
        "last_viewed_at": row.last_viewed_at.isoformat() if row.last_viewed_at else None,
        "created_by": row.created_by.full_name if row.created_by else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _audit_state(row) -> dict[str, Any]:
    return {
        "label": row.label, "has_password": bool(row.password_hash),
        "expires_at": row.expires_at, "allow_embed": bool(row.allow_embed),
        "allowed_origins": list(row.allowed_origins or []),
    }
