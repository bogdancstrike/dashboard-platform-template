"""Watches: catalogue, list, read, create, change, remove, silence."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select

from src.core import audit
from src.core.clock import now
from src.core.errors import ValidationError
from src.services.analytics.metric_watches.detection import MANAGE, VIEW
from src.services.analytics.metric_watches.evaluation import evaluate
from src.services.analytics.metric_watches.measurement import _resource, series
from src.services.analytics.metric_watches.rows import (
    _audit_state,
    _load,
    _maybe_catch_up,
    _watch_dict,
)
from src.services.analytics.metric_watches.validation import (
    _check_measure,
    _config,
    validated,
)


def listing(session, args, *, principal) -> dict[str, Any]:
    from src.models.records_analytics import MetricAnomaly, MetricWatch

    principal.require(VIEW)
    _maybe_catch_up(session)
    statement = select(MetricWatch).where(MetricWatch.deleted_at.is_(None)).order_by(MetricWatch.name)
    status = str(args.get("status") or "").upper()
    if status:
        statement = statement.where(MetricWatch.last_status == status)
    query = str(args.get("q") or "").strip()
    if query:
        statement = statement.where(MetricWatch.name.ilike(f"%{query}%"))
    rows = session.scalars(statement).all()
    open_counts = dict(session.execute(
        select(MetricAnomaly.watch_id, func.count())
        .where(MetricAnomaly.status == "OPEN")
        .group_by(MetricAnomaly.watch_id)
    ).all())
    latest = dict(session.execute(
        select(MetricAnomaly.watch_id, func.max(MetricAnomaly.bucket_at)).group_by(MetricAnomaly.watch_id)
    ).all())
    items = []
    for row in rows:
        item = _watch_dict(row, principal)
        item["open_anomalies"] = int(open_counts.get(row.id, 0))
        item["last_anomaly_at"] = latest[row.id].isoformat() if latest.get(row.id) else None
        try:
            item["sparkline"] = [p["value"] for p in series(session, _config(row), points=20)]
        except ValidationError:
            item["sparkline"] = []
        items.append(item)
    total_open = sum(int(v) for v in open_counts.values())
    return {"items": items, "total": len(items), "open_anomalies": total_open, "can_manage": principal.can(MANAGE)}


def get(session, watch_id: Any, *, principal) -> dict[str, Any]:
    principal.require(VIEW)
    row = _load(session, watch_id)
    _resource(row.dataset)
    principal.require(_resource(row.dataset).permission)
    return _watch_dict(row, principal)


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.records_analytics import MetricWatch

    principal.require(MANAGE)
    values = validated(payload, principal=principal)
    _check_measure(values)
    row = MetricWatch(owner_id=principal.user_id, muted=False, **{"enabled": True, **values})
    session.add(row)
    session.flush()
    audit.record(session, action="CREATE", resource_type="metric_watch", resource_id=row.id,
                 resource_label=row.name, principal=principal, after=_audit_state(row),
                 message=f"created the watch {row.name}")
    evaluate(session, row, backfill=True, notify=False)
    return _watch_dict(row, principal)


def update(session, watch_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    row = _load(session, watch_id)
    before = _audit_state(row)
    values = validated(payload, partial=True, principal=principal)
    merged = {**_config(row), **values}
    _check_measure(merged)
    values["measure_field"] = merged["measure_field"]
    for key, value in values.items():
        setattr(row, key, value)
    session.flush()
    audit.record(session, action="UPDATE", resource_type="metric_watch", resource_id=row.id,
                 resource_label=row.name, principal=principal, before=before, after=_audit_state(row),
                 message=f"updated the watch {row.name}")
    detection = {"dataset", "measure", "measure_field", "date_field", "filters", "granularity",
                 "method", "sensitivity", "threshold", "direction", "window"}
    if detection & set(values):
        evaluate(session, row, backfill=True, notify=False)
    return _watch_dict(row, principal)


def remove(session, watch_id: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    row = _load(session, watch_id)
    row.deleted_at = now()
    audit.record(session, action="DELETE", resource_type="metric_watch", resource_id=row.id,
                 resource_label=row.name, principal=principal, before={"deleted": False},
                 after={"deleted": True}, message=f"deleted the watch {row.name}")
    session.flush()
    return {"id": str(row.id), "deleted": True}


def silence(session, watch_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Snooze for a while, mute until unmuted, or clear both."""
    principal.require(MANAGE)
    row = _load(session, watch_id)
    if not isinstance(payload, dict):
        raise ValidationError("The request must be a JSON object.")
    before = {"muted": bool(row.muted), "snoozed_until": row.snoozed_until}
    if payload.get("clear"):
        row.muted = False
        row.snoozed_until = None
    if "muted" in payload:
        row.muted = bool(payload.get("muted"))
    if payload.get("hours") not in (None, ""):
        try:
            hours = float(payload["hours"])
        except (TypeError, ValueError) as exc:
            raise ValidationError("hours must be a number.", details={"field": "hours"}) from exc
        if not 0 < hours <= 24 * 90:
            raise ValidationError("A snooze lasts between a moment and 90 days.", details={"field": "hours"})
        row.snoozed_until = now() + timedelta(hours=hours)
    elif payload.get("until"):
        try:
            until = datetime.fromisoformat(str(payload["until"]).replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValidationError("until must be a timestamp.", details={"field": "until"}) from exc
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        if until <= now():
            raise ValidationError("A snooze has to end in the future.", details={"field": "until"})
        row.snoozed_until = until
    session.flush()
    audit.record(session, action="CONFIGURATION_CHANGE", resource_type="metric_watch", resource_id=row.id,
                 resource_label=row.name, principal=principal, before=before,
                 after={"muted": bool(row.muted), "snoozed_until": row.snoozed_until},
                 message=f"silenced the watch {row.name}" if (row.muted or row.snoozed_until)
                 else f"unsilenced the watch {row.name}")
    return _watch_dict(row, principal)
