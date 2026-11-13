"""Loading a watch, and watches and anomalies as the API returns them."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.core.errors import NotFoundError
from src.core.pagination import parse_uuid
from src.services.analytics import jobs as analytics_jobs
from src.services.analytics.metric_watches.detection import MANAGE, threshold_of
from src.services.analytics.metric_watches.validation import _config


def _load(session, watch_id: Any):
    from src.models.records_analytics import MetricWatch

    identifier = parse_uuid(watch_id, field="watch_id")
    row = session.scalars(
        select(MetricWatch).where(MetricWatch.id == identifier, MetricWatch.deleted_at.is_(None))
    ).first()
    if row is None:
        raise NotFoundError("That watch does not exist.", details={"id": str(watch_id)})
    return row


def _watch_dict(row, principal) -> dict[str, Any]:
    snoozed = bool(row.snoozed_until and row.snoozed_until > now())
    return {
        "id": str(row.id),
        "name": row.name,
        "description": row.description,
        **_config(row),
        "channels": list(row.channels or []),
        "recipient_ids": list(row.recipient_ids or []),
        "enabled": bool(row.enabled),
        "muted": bool(row.muted),
        "snoozed_until": row.snoozed_until.isoformat() if snoozed else None,
        "owner": {"id": str(row.owner_id) if row.owner_id else None,
                  "name": row.owner.full_name if row.owner else None},
        "last_evaluated_at": row.last_evaluated_at.isoformat() if row.last_evaluated_at else None,
        "last_status": row.last_status,
        "last_value": row.last_value,
        "last_error": row.last_error,
        "threshold_effective": threshold_of(_config(row)),
        "can_edit": principal.can(MANAGE),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _audit_state(row) -> dict[str, Any]:
    return {**_config(row), "name": row.name, "enabled": bool(row.enabled),
            "channels": list(row.channels or [])}


def _anomaly_dict(row, *, include_series: bool = True) -> dict[str, Any]:
    out = {
        "id": str(row.id),
        "watch_id": str(row.watch_id),
        "watch_name": row.watch.name if row.watch else None,
        "bucket_at": row.bucket_at.isoformat(),
        "value": row.value,
        "expected": row.expected,
        "stddev": row.stddev,
        "zscore": row.zscore,
        "direction": row.direction,
        "severity": row.severity,
        "status": row.status,
        "notified": bool(row.notified),
        "suppressed_reason": row.suppressed_reason,
        "acknowledged_at": row.acknowledged_at.isoformat() if row.acknowledged_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
    if include_series:
        out["series"] = row.series or []
        out["granularity"] = row.watch.granularity if row.watch else None
    return out


def _maybe_catch_up(session) -> None:

    analytics_jobs.catch_up(session)
