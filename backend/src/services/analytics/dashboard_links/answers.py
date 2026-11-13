"""What a public widget answers, asked as the dashboard's owner."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.errors import ApiError, NotFoundError, ValidationError
from src.services.analytics.dashboard_links.link_state import (
    CHART_FOR,
    PUBLIC_KINDS,
    READ_ONLY,
    VIEW_LIMIT,
    _status,
)
from src.services.analytics.dashboard_links.rate_limits import _limit


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
    from src.services.analytics import analysis, reports
    from src.services.records import explorer

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
