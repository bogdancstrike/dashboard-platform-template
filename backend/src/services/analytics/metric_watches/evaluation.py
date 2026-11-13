"""Evaluating watches, now or on the hourly job, and notifying on a new anomaly."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select

from src.core.clock import now
from src.core.errors import ValidationError
from src.services.analytics import jobs as analytics_jobs
from src.services.analytics.metric_watches.detection import (
    HISTORY,
    SEASON,
    SEASON_CYCLES,
    VIEW,
    judge,
)
from src.services.analytics.metric_watches.measurement import _resource, series
from src.services.analytics.metric_watches.rows import _anomaly_dict, _load, _watch_dict
from src.services.analytics.metric_watches.validation import _config
from src.services.collaboration.automated_mail import next_message_ref


def evaluate(session, row, *, backfill: bool = False, notify: bool = True,
             until: datetime | None = None) -> dict[str, Any]:
    """Judge the latest points (or the whole visible history) and record anomalies."""
    from src.models.records_analytics import MetricAnomaly

    config = _config(row)
    try:
        points = series(session, config, until=until, points=HISTORY + int(row.window or 14)
                        if config["method"] == "zscore" else HISTORY + SEASON[row.granularity] * SEASON_CYCLES)
    except ValidationError as error:
        row.last_status, row.last_error, row.last_evaluated_at = "ERROR", error.message, now()
        session.flush()
        return {"status": "ERROR", "new": 0, "error": error.message}

    values = [float(p["value"]) for p in points]
    last = len(points) - 1
    indexes = range(max(0, last - HISTORY + 1), last + 1) if backfill else range(max(0, last - 1), last + 1)
    existing = {
        (a.bucket_at.astimezone(timezone.utc).isoformat())
        for a in session.scalars(select(MetricAnomaly).where(MetricAnomaly.watch_id == row.id))
    }
    created = []
    latest_verdict = None
    for index in indexes:
        verdict = judge(values, index, config, partial=index == last)
        if index == last:
            latest_verdict = verdict
        if verdict is None or not verdict["unusual"]:
            continue
        at = points[index]["at"]
        if at in existing:
            continue
        window = points[max(0, index - 20): index + 4]
        recent = index >= last - 1
        suppressed = None
        if row.muted:
            suppressed = "muted"
        elif row.snoozed_until and row.snoozed_until > now():
            suppressed = "snoozed"
        anomaly = MetricAnomaly(
            watch_id=row.id, bucket_at=datetime.fromisoformat(at), value=values[index],
            expected=verdict["expected"], stddev=verdict["stddev"], zscore=verdict["zscore"],
            direction=verdict["direction"], severity=verdict["severity"], series=window,
            status="OPEN" if recent else "ACKNOWLEDGED", notified=False, suppressed_reason=suppressed,
        )
        session.add(anomaly)
        session.flush()
        existing.add(at)
        created.append(anomaly)
        if notify and recent and suppressed is None:
            _notify(session, row, anomaly)
            anomaly.notified = True

    row.last_evaluated_at = now()
    row.last_value = values[last] if values else None
    row.last_error = None
    if not any(values):
        row.last_status = "NO_DATA"
    elif latest_verdict and latest_verdict["unusual"] or any(a.bucket_at >= datetime.fromisoformat(points[max(0, last - 1)]["at"]) for a in created):
        row.last_status = "ANOMALY"
    else:
        row.last_status = "OK"
    session.flush()
    return {"status": row.last_status, "new": len(created),
            "anomalies": [_anomaly_dict(a, include_series=False) for a in created]}


def evaluate_now(session, watch_id: Any, *, principal) -> dict[str, Any]:
    principal.require(VIEW)
    row = _load(session, watch_id)
    principal.require(_resource(row.dataset).permission)
    result = evaluate(session, row, notify=True)
    return {**result, "watch": _watch_dict(row, principal)}


@analytics_jobs.runner("analytics.anomaly-watch")
def _hourly_job(session) -> tuple[dict[str, Any], str, int]:
    outcome = evaluate_all(session)
    line = f"{outcome['watches']} watch(es) evaluated, {outcome['anomalies']} new anomal(ies)"
    return outcome, line, outcome["watches"]


def evaluate_all(session) -> dict[str, Any]:
    from src.models.records_analytics import MetricWatch

    rows = session.scalars(
        select(MetricWatch).where(MetricWatch.deleted_at.is_(None), MetricWatch.enabled.is_(True))
    ).all()
    made = 0
    for row in rows:
        made += evaluate(session, row, notify=True)["new"]
    return {"watches": len(rows), "anomalies": made}


def _recipients(row) -> list[UUID]:
    ids: list[UUID] = []
    for raw in [row.owner_id, *(row.recipient_ids or [])]:
        if raw is None:
            continue
        value = raw if isinstance(raw, UUID) else UUID(str(raw))
        if value not in ids:
            ids.append(value)
    return ids


def _describe(row, anomaly) -> tuple[str, str]:
    kind = "spike" if anomaly.direction == "up" else "drop"
    at = anomaly.bucket_at.astimezone(timezone.utc)
    when = at.strftime("%d %b %H:00" if row.granularity == "hour" else "%d %b")
    title = f"{row.name}: unusual {kind}"
    body = (f"{_number(anomaly.value)} on {when} against an expected {_number(anomaly.expected)} "
            f"(z = {anomaly.zscore:+.1f}).")
    return title, body


def _number(value: float) -> str:
    return f"{value:,.0f}" if abs(value) >= 100 or float(value).is_integer() else f"{value:,.2f}"


def _notify(session, row, anomaly) -> None:
    from src.models.content import EmailMessage
    from src.models.identity import User
    from src.services.collaboration import notifications

    title, body = _describe(row, anomaly)
    people = _recipients(row)
    if "in_app" in (row.channels or ["in_app"]):
        for user_id in people:
            notifications.publish(
                session, user_id=user_id, category="ALERT", severity=anomaly.severity,
                title=title, body=body, link=f"/alerts/{row.id}?anomaly={anomaly.id}", icon="activity",
                resource_type="metric_watch", resource_id=str(row.id), group_key=f"anomaly:{row.id}",
                metadata={"anomaly_id": str(anomaly.id), "direction": anomaly.direction},
            )
    if "email" in (row.channels or []) and people:
        users = session.scalars(select(User).where(User.id.in_(people))).all()
        session.add(EmailMessage(
            message_ref=next_message_ref(session), subject=title[:300],
            from_name="Nucleus alerts", from_email="alerts@nucleus.local",
            to_recipients=[{"name": u.full_name, "email": u.email} for u in users],
            body_text=f"{body}\n\nOpen the alert: /alerts/{row.id}", preview=body[:400],
            folder="OUTBOX", is_read=True, priority="HIGH" if anomaly.severity == "CRITICAL" else "NORMAL",
            owner_id=row.owner_id, sent_at=now(),
        ))
        session.flush()
