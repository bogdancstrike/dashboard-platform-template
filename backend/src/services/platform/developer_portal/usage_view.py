"""Usage per API client."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import Integer, case, cast, func, select

from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.services.platform.developer_portal.guards import USAGE_PERMISSION


def usage(session, args, *, principal) -> dict[str, Any]:
    """Requests, errors, latency and the busiest routes — overall or for one client."""
    from src.models.platform import ApiClient, ApiRequestLog

    principal.require(USAGE_PERMISSION)
    try:
        days = max(1, min(int(args.get("days") or 14), 90))
    except (TypeError, ValueError) as error:
        raise ValidationError("days must be a whole number.") from error
    since = now() - timedelta(days=days)
    log = ApiRequestLog
    where = [log.requested_at >= since]
    client = None
    if args.get("client"):
        client = get_or_404(
            session,
            ApiClient,
            parse_uuid(args.get("client"), field="client"),
            "That API client does not exist.",
            live=True,
        )
        where.append(log.api_client_id == client.id)

    failed = case((log.status_code >= 400, 1), else_=0)
    day = func.date_trunc("day", log.requested_at)
    series = session.execute(
        select(day.label("day"), func.count().label("requests"), func.sum(failed).label("errors"),
               func.percentile_cont(0.5).within_group(log.duration_ms).label("p50"),
               func.percentile_cont(0.95).within_group(log.duration_ms).label("p95"))
        .where(*where).group_by(day).order_by(day)
    ).all()
    top = session.execute(
        select(log.method, log.path, func.count().label("requests"), func.sum(failed).label("errors"),
               func.avg(log.duration_ms).label("avg_ms"))
        .where(*where).group_by(log.method, log.path).order_by(func.count().desc()).limit(10)
    ).all()
    codes = session.execute(
        select(log.status_code, func.count()).where(*where).group_by(log.status_code).order_by(log.status_code)
    ).all()
    per_client = session.execute(
        select(ApiClient.id, ApiClient.name, ApiClient.client_id, ApiClient.status,
               func.count(log.id).label("requests"), func.coalesce(func.sum(cast(log.status_code >= 400, Integer)), 0).label("errors"),
               func.percentile_cont(0.95).within_group(log.duration_ms).label("p95"),
               func.max(log.requested_at).label("last"))
        .join(log, (log.api_client_id == ApiClient.id) & (log.requested_at >= since), isouter=True)
        .where(ApiClient.deleted_at.is_(None))
        .group_by(ApiClient.id).order_by(func.count(log.id).desc())
    ).all()
    total = sum(int(row.requests) for row in series)
    errors = sum(int(row.errors or 0) for row in series)
    return {
        "days": days,
        "client": {"id": str(client.id), "name": client.name} if client else None,
        "totals": {
            "requests": total,
            "errors": errors,
            "error_rate": round(errors / total, 4) if total else 0,
            "p95_ms": round(max((float(r.p95 or 0) for r in series), default=0), 1),
        },
        "series": [{"day": iso(row.day)[:10], "requests": int(row.requests), "errors": int(row.errors or 0),
                    "p50_ms": round(float(row.p50 or 0), 1), "p95_ms": round(float(row.p95 or 0), 1)}
                   for row in series],
        "top_endpoints": [{"method": row.method, "path": row.path, "requests": int(row.requests),
                           "errors": int(row.errors or 0), "avg_ms": round(float(row.avg_ms or 0), 1)}
                          for row in top],
        "status_codes": [{"code": int(code), "count": int(count)} for code, count in codes],
        "clients": [{"id": str(row.id), "name": row.name, "client_id": row.client_id, "status": row.status,
                     "requests": int(row.requests), "errors": int(row.errors or 0),
                     "p95_ms": round(float(row.p95 or 0), 1), "last_used_at": iso(row.last)}
                    for row in per_client],
    }
