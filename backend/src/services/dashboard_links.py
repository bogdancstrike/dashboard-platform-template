"""Public and embeddable dashboard links (§25), with expiry and passwords.

**A link is a token, and the token is the credential.** 32 random bytes,
URL-safe; the address is `/share/dashboards/<token>`. A link can carry a
password (stored as a salted hash), an expiry, a list of origins allowed to
embed it in an iframe, and it can be revoked. Every successful view counts.

**A password is exchanged for a grant.** `POST …/unlock` checks the password
and answers with a short-lived signed grant (`itsdangerous`, keyed on the
app secret) naming the link and its password version — so changing the
password lapses every grant already handed out, and the password itself is
never sent twice.

**The data is resolved on the server, as the owner, read-only.** A public
reader has no session, so the page cannot call the dataset endpoints a widget
normally uses. Instead the public endpoint answers each widget's question
itself, through the *same* services those endpoints use (explorer insights
and queries, the analysis compiler, saved reports), as a principal built from
the dashboard owner with only the read permissions — so a public dashboard
can never show more than its owner could see, and nothing on it can write.
Widgets that are a window onto somebody's own workspace — mail, tasks,
notifications, files — are not published; they render as "private".

**Rate limited.** Views per address per link per minute, and password
attempts far more tightly, in Redis when it is there and in-process when not.
"""

from __future__ import annotations

import secrets
import threading
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import select
from werkzeug.security import check_password_hash, generate_password_hash

from src.core import audit, cache
from src.core.clock import now
from src.core.errors import (
    ApiError,
    ForbiddenError,
    NotFoundError,
    RateLimitedError,
    UnauthorizedError,
    ValidationError,
)
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


# ── management ───────────────────────────────────────────────────────────


def _owned_dashboard(session, dashboard_id: Any, principal):
    from src.services.dashboards import _owned

    return _owned(session, dashboard_id, principal)


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


# ── rate limiting ────────────────────────────────────────────────────────

_local_counts: dict[str, tuple[float, int]] = {}
_local_lock = threading.Lock()


def _hit(key: str, *, window: int) -> int:
    """Count one hit in a fixed window; Redis when there is one."""
    counted = cache.incr(f"public-dash:{key}", ttl=window)
    if counted:
        return counted
    bucket = int(time.time() // window)
    with _local_lock:
        started, count = _local_counts.get(key, (bucket, 0))
        if started != bucket:
            started, count = bucket, 0
        count += 1
        _local_counts[key] = (started, count)
        if len(_local_counts) > 10_000:  # pragma: no cover - a flood of distinct keys
            _local_counts.clear()
        return count


def _limit(key: str, *, limit: int, window: int) -> None:
    if _hit(key, window=window) > limit:
        raise RateLimitedError("Too many requests — wait a minute and try again.",
                               details={"limit": limit, "window_seconds": window})


# ── the public side ──────────────────────────────────────────────────────


def _serializer():
    from itsdangerous import URLSafeTimedSerializer

    from src.config import Config

    return URLSafeTimedSerializer(Config.SECRET_KEY, salt="nucleus-public-dashboard")


def _live_link(session, token: str):
    from src.models.records_analytics import DashboardLink

    if not token or len(token) > 64:
        raise NotFoundError("This link does not exist.")
    row = session.scalars(select(DashboardLink).where(DashboardLink.token == token)).first()
    if row is None or (row.dashboard is None or row.dashboard.deleted_at is not None):
        raise NotFoundError("This link does not exist.")
    status = _status(row)
    if status == "REVOKED":
        raise _gone("This link has been revoked by its owner.", "revoked")
    if status == "EXPIRED":
        raise _gone("This link has expired.", "expired")
    return row


class _Gone(ApiError):
    code = "link_unavailable"
    status_code = 410


def _gone(message: str, reason: str) -> ApiError:
    return _Gone(message, details={"reason": reason})


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


def _granted(row, grant: str | None) -> bool:
    if not row.password_hash:
        return True
    if not grant:
        return False
    from itsdangerous import BadSignature, SignatureExpired

    try:
        claims = _serializer().loads(grant, max_age=GRANT_SECONDS)
    except (BadSignature, SignatureExpired):
        return False
    return claims.get("link") == str(row.id) and int(claims.get("v", -1)) == int(row.password_version or 0)


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


def meta(session, token: str, *, client: str) -> dict[str, Any]:
    """What the page needs before it asks for data: does it need a password?"""
    _limit(f"view:{token}:{client}", limit=VIEW_LIMIT, window=60)
    row = _live_link(session, token)
    return {
        "name": row.dashboard.name,
        "has_password": bool(row.password_hash),
        "allow_embed": bool(row.allow_embed),
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
    }


def _owner_principal(session, owner_id):
    from sqlalchemy.orm import selectinload

    from src.core.auth import DEFAULT_ROLE_CODE, Principal
    from src.core.auth.users import permissions_for
    from src.models.identity import User

    user = session.scalars(
        select(User).options(selectinload(User.groups), selectinload(User.role)).where(User.id == owner_id)
    ).first()
    if user is None or user.deleted_at is not None:
        raise _gone("The owner of this dashboard no longer has an account.", "owner_gone")
    role_code = user.role.code if user.role else DEFAULT_ROLE_CODE
    permissions = permissions_for(session, user, role_code) & READ_ONLY
    return Principal(
        user_id=user.id, subject=user.external_id or "", email=user.email, username=user.username,
        full_name=user.full_name, role_code=role_code, permissions=frozenset(permissions),
        organization_id=user.organization_id, department_id=user.department_id,
    )


def _answer(session, widget, owner, period: str) -> dict[str, Any]:
    """One widget's data, or why it is not published."""
    from src.services import analysis, explorer, reports

    config = widget.config or {}
    kind = widget.kind
    if kind not in PUBLIC_KINDS:
        return {"type": "private", "message": "This widget shows a personal workspace and is not published."}
    entity = str(config.get("entity") or "")
    nested = session.begin_nested()
    try:
        if kind == "REPORT":
            if not config.get("report_id"):
                raise ValidationError("No report chosen.")
            ran = reports.run(session, config["report_id"], {"period": config.get("period") or period},
                              principal=owner)
            chart = str(ran["report"].get("visualization") or "bar").lower()
            out = {"type": "chart", "chart": chart if chart in CHART_FOR.values() else "bar",
                   "result": ran["result"]}
        elif not entity:
            out = {"type": "empty", "message": "Nothing chosen yet."}
        elif kind in ("KPI", "GAUGE", "ANALYTICS"):
            insights = explorer.insights(session, {"resource_type": entity, "filters": config.get("filters") or {}},
                                         principal=owner)
            out = {"type": "metrics", "gauge": kind == "GAUGE", "strip": kind == "ANALYTICS",
                   "metric": config.get("metric"), "metrics": insights.get("metrics", [])}
        elif kind in ("LIST", "TABLE"):
            resource = explorer.resource_for(entity, principal=owner)
            columns = list(resource.default_columns[:3])
            result = explorer.run(session, {
                "resource_type": entity, "filters": config.get("filters") or {},
                "columns": columns if kind == "TABLE" else [resource.title_field, resource.status_field],
                "sort": "updated_at", "order": "desc", "page_size": 5 if kind == "TABLE" else 6,
            }, principal=owner)
            labels = {f["name"]: f.get("label") or f["name"] for f in resource.fields.describe()}
            out = {"type": "rows", "table": kind == "TABLE", "columns": [
                {"name": c, "label": labels.get(c, c)} for c in columns],
                "title_field": resource.title_field, "status_field": resource.status_field,
                "items": result.get("items", [])}
        else:
            chart = str(config.get("chart") or CHART_FOR.get(kind, "bar")) if kind == "CHART" else CHART_FOR[kind]
            catalogue = analysis.catalogue(principal=owner)
            dataset = next((d for d in catalogue["datasets"] if d["key"] == entity), None)
            if dataset is None:
                raise ValidationError("Unknown dataset.")
            over_time = chart in ("line", "area")
            group = config.get("dimension") or (dataset["default_date"] if over_time else None) or (
                dataset["dimensions"][0]["name"] if dataset["dimensions"] else "")
            granularity = config.get("granularity") or ("month" if over_time else "")
            stack = config.get("stack") or (dataset["dimensions"][1]["name"]
                                            if chart == "heatmap" and len(dataset["dimensions"]) > 1 else "")
            measure = ({"aggregation": config["aggregation"], "field": config.get("measure")}
                       if config.get("aggregation") not in (None, "", "count") and config.get("measure")
                       else {"aggregation": "count"})
            request = {
                "resource_type": entity,
                "dimensions": ([{"field": group, "granularity": granularity}] if group else [])
                + ([{"field": stack, "granularity": ""}] if stack else []),
                "measures": [measure], "filters": config.get("filters") or {},
                "period": config.get("period") or period,
            }
            try:
                result = analysis.run(session, request, principal=owner)
            except ValidationError as refused:
                # A widget saved with a period the compiler no longer knows is
                # drawn over the dashboard's own period rather than not at all.
                if request["period"] == period or "period" not in str(refused.message).lower():
                    raise
                result = analysis.run(session, {**request, "period": period}, principal=owner)
            out = {"type": "chart", "chart": chart, "result": result}
        nested.commit()
        return out
    except ApiError as error:
        nested.rollback()
        return {"type": "error", "message": str(error.message)}
