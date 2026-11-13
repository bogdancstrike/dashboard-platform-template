"""A watch's chart, a preview, and the anomalies: list, one, acknowledge."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, select

from src.core import audit
from src.core.clock import now
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.services.analytics.metric_watches.detection import (
    HISTORY,
    SEASON,
    SEASON_CYCLES,
    VIEW,
    annotate,
    threshold_of,
)
from src.services.analytics.metric_watches.measurement import _resource, series
from src.services.analytics.metric_watches.rows import _anomaly_dict, _load, _watch_dict
from src.services.analytics.metric_watches.validation import (
    _check_measure,
    _config,
    validated,
)


def chart(session, watch_id: Any, args, *, principal) -> dict[str, Any]:
    """The series as the detector sees it, with its band and the flagged points."""
    from src.models.records_analytics import MetricAnomaly

    principal.require(VIEW)
    row = _load(session, watch_id)
    principal.require(_resource(row.dataset).permission)
    config = _config(row)
    try:
        span = max(10, min(120, int(args.get("points") or 45)))
    except (TypeError, ValueError) as exc:
        raise ValidationError("points must be a whole number.") from exc
    lead = int(row.window or 14) if row.method == "zscore" else SEASON[row.granularity] * SEASON_CYCLES
    points = series(session, config, points=span + lead)
    annotated = annotate(points, config)[lead:]
    first = datetime.fromisoformat(annotated[0]["at"]) if annotated else now()
    anomalies = session.scalars(
        select(MetricAnomaly).where(MetricAnomaly.watch_id == row.id, MetricAnomaly.bucket_at >= first)
        .order_by(MetricAnomaly.bucket_at)
    ).all()
    return {
        "watch": _watch_dict(row, principal),
        "points": annotated,
        "anomalies": [_anomaly_dict(a, include_series=False) for a in anomalies],
    }


def preview(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """What a draft watch would see and flag, without saving anything."""
    principal.require(VIEW)
    values = validated(payload, principal=principal) if payload.get("name") else validated(
        {**payload, "name": "draft"}, principal=principal)
    _check_measure(values)
    lead = values["window"] if values["method"] == "zscore" else SEASON[values["granularity"]] * SEASON_CYCLES
    points = series(session, values, points=HISTORY + lead)
    annotated = annotate(points, values)[lead:]
    return {
        "points": annotated,
        "flagged": sum(1 for p in annotated if p.get("unusual")),
        "threshold": threshold_of(values),
    }


def anomalies(session, args, *, principal) -> dict[str, Any]:
    from src.models.records_analytics import MetricAnomaly, MetricWatch

    principal.require(VIEW)
    statement = (
        select(MetricAnomaly).join(MetricWatch, MetricWatch.id == MetricAnomaly.watch_id)
        .where(MetricWatch.deleted_at.is_(None))
    )
    if args.get("watch_id"):
        statement = statement.where(MetricAnomaly.watch_id == parse_uuid(args.get("watch_id"), field="watch_id"))
    status = str(args.get("status") or "").upper()
    if status:
        statement = statement.where(MetricAnomaly.status == status)
    direction = str(args.get("direction") or "").lower()
    if direction in ("up", "down"):
        statement = statement.where(MetricAnomaly.direction == direction)
    total = session.scalar(select(func.count()).select_from(statement.subquery()))
    try:
        page = max(1, int(args.get("page") or 1))
        size = max(1, min(100, int(args.get("page_size") or 25)))
    except (TypeError, ValueError) as exc:
        raise ValidationError("page and page_size must be integers.") from exc
    rows = session.scalars(
        statement.order_by(MetricAnomaly.bucket_at.desc()).offset((page - 1) * size).limit(size)
    ).all()
    return {"items": [_anomaly_dict(r) for r in rows], "total": int(total or 0), "page": page, "page_size": size}


def anomaly(session, anomaly_id: Any, *, principal) -> dict[str, Any]:
    from src.models.records_analytics import MetricAnomaly

    principal.require(VIEW)
    row = session.get(MetricAnomaly, parse_uuid(anomaly_id, field="anomaly_id"))
    if row is None or (row.watch and row.watch.deleted_at):
        raise NotFoundError("That alert does not exist.", details={"id": str(anomaly_id)})
    return _anomaly_dict(row)


def acknowledge(session, anomaly_id: Any, *, principal) -> dict[str, Any]:
    from src.models.records_analytics import MetricAnomaly

    principal.require(VIEW)
    row = get_or_404(
        session,
        MetricAnomaly,
        parse_uuid(anomaly_id, field="anomaly_id"),
        "That alert does not exist.",
        details={"id": str(anomaly_id)},
    )
    if row.status != "ACKNOWLEDGED":
        row.status = "ACKNOWLEDGED"
        row.acknowledged_at = now()
        row.acknowledged_by_id = principal.user_id
        audit.record(session, action="UPDATE", resource_type="metric_anomaly", resource_id=row.id,
                     resource_label=row.watch.name if row.watch else "", principal=principal,
                     before={"status": "OPEN"}, after={"status": "ACKNOWLEDGED"},
                     message="acknowledged an anomaly", activity=False)
        session.flush()
    return _anomaly_dict(row)
