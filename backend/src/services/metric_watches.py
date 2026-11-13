"""Anomaly alerts (§22): watch a metric and notify on a spike or a drop.

**A watch is a question the explorer can already answer**, asked over time: a
dataset, a measure (a count of rows, or the sum or average of a number), the
same filter arguments a list's URL carries, and a granularity. The series is
one grouped `date_trunc` in PostgreSQL over the dataset's own declared date
field, with empty buckets filled as zero — a day nobody placed an order is a
day with no orders, not a gap.

**Detection is deliberately simple and explainable.**

* `zscore` judges each point against the mean and standard deviation of the
  `window` points before it.
* `seasonal` judges it against the *same slot* in earlier cycles — the same
  hour on previous days, the same weekday in previous weeks — which is what
  stops every Monday from being a spike in a weekly-shaped business.

Sensitivity is the z threshold (low 4, medium 3, high 2.2) unless a watch
sets one. A standard deviation is floored so a flat-zero baseline does not
make one stray row "infinitely" unusual. The bucket still in progress is only
ever judged for a *spike* — it can still grow, so it cannot yet be a drop.

**Every flagged point is kept** (`metric_anomalies`), with the window it was
judged against, so the alert page redraws the chart exactly as the detector
saw it. A snoozed or muted watch still records; it just does not tell anybody,
and says why.

**Notifications** go to the owner and the named recipients: in-app, and — when
the watch asks for it — an email written into the platform's mailbox outbox,
the same honest delivery automations use.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import func, select

from src.core import audit
from src.core.clock import now
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.core.query import apply_filters
from src.core.repository import get_or_404

VIEW = "records.view"
MANAGE = "alerts.manage"

MEASURES = ("count", "sum", "avg")
GRANULARITIES = {"hour": timedelta(hours=1), "day": timedelta(days=1), "week": timedelta(weeks=1)}
METHODS = ("zscore", "seasonal")
SENSITIVITY = {"low": 4.0, "medium": 3.0, "high": 2.2}
DIRECTIONS = ("both", "up", "down")
CHANNELS = ("in_app", "email")
#: How many cycles back a seasonal baseline reaches, and how long a cycle is.
SEASON_CYCLES = 4
SEASON = {"hour": 24, "day": 7, "week": 4}
#: Points drawn on a chart and examined by a backfill.
HISTORY = 30
MIN_BASELINE = 3


# ── series ───────────────────────────────────────────────────────────────


def _resource(dataset: str):
    from src.services.explorer import resource_for

    return resource_for(dataset)


def _date_field(resource, name: str | None) -> str:
    candidates = [name, resource.insight.trend, "created_at"]
    for candidate in candidates:
        field = resource.fields.by_name.get(candidate or "")
        if field is not None and field.kind == "datetime":
            return field.name
    raise ValidationError("That dataset has no date to watch over.", details={"dataset": resource.key})


def _floor(moment: datetime, granularity: str) -> datetime:
    moment = moment.astimezone(timezone.utc)
    if granularity == "hour":
        return moment.replace(minute=0, second=0, microsecond=0)
    day = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    if granularity == "week":
        return day - timedelta(days=day.weekday())
    return day


def series(session, config: dict[str, Any], *, until: datetime | None = None, points: int = HISTORY) -> list[dict[str, Any]]:
    """`points` buckets ending with the one `until` falls in, oldest first."""
    resource = _resource(config["dataset"])
    granularity = config["granularity"]
    step = GRANULARITIES[granularity]
    date_name = _date_field(resource, config.get("date_field"))
    column = resource.fields.by_name[date_name].column
    end = _floor(until or now(), granularity)
    start = end - step * (points - 1)

    measure = config.get("measure") or "count"
    if measure == "count":
        aggregate = func.count()
    else:
        field = resource.fields.by_name.get(config.get("measure_field") or "")
        if field is None or field.kind != "number":
            raise ValidationError("A sum or an average needs a number field.",
                                  details={"field": "measure_field"})
        aggregate = (func.sum if measure == "sum" else func.avg)(field.column)

    bucket = func.date_trunc(granularity, func.timezone("UTC", column)).label("bucket")
    statement = select(bucket, aggregate.label("value")).select_from(resource.model)
    deleted = getattr(resource.model, "deleted_at", None)
    if deleted is not None:
        statement = statement.where(deleted.is_(None))
    statement = apply_filters(statement, dict(config.get("filters") or {}), resource.fields)
    statement = statement.where(column >= start, column < end + step).group_by(bucket)

    found: dict[datetime, float] = {}
    for at, value in session.execute(statement):
        key = at.replace(tzinfo=timezone.utc) if at.tzinfo is None else at.astimezone(timezone.utc)
        found[key] = float(value or 0)
    out = []
    for index in range(points):
        at = start + step * index
        out.append({"at": at.isoformat(), "value": round(found.get(at, 0.0), 4)})
    return out


# ── detection (pure) ─────────────────────────────────────────────────────


def threshold_of(config: dict[str, Any]) -> float:
    if config.get("threshold"):
        return float(config["threshold"])
    return SENSITIVITY.get(config.get("sensitivity") or "medium", 3.0)


def baseline(values: list[float], index: int, config: dict[str, Any]) -> list[float]:
    window = int(config.get("window") or 14)
    if config.get("method") == "seasonal":
        cycle = SEASON[config["granularity"]]
        picked = [values[index - cycle * k] for k in range(1, SEASON_CYCLES + 1) if index - cycle * k >= 0]
        return picked
    return values[max(0, index - window):index]


def judge(values: list[float], index: int, config: dict[str, Any], *, partial: bool = False) -> dict[str, Any] | None:
    """The verdict on one point: expected, spread, z, and whether it is unusual."""
    reference = baseline(values, index, config)
    if len(reference) < MIN_BASELINE:
        return None
    mean = sum(reference) / len(reference)
    spread = math.sqrt(sum((v - mean) ** 2 for v in reference) / len(reference))
    floor = max(abs(mean) * 0.1, 1.0 if (config.get("measure") or "count") == "count" else 1e-6)
    effective = max(spread, floor)
    value = values[index]
    z = (value - mean) / effective
    limit = threshold_of(config)
    direction = "up" if z > 0 else "down"
    wanted = config.get("direction") or "both"
    unusual = abs(z) >= limit and (wanted == "both" or wanted == direction)
    if partial and direction == "down":
        unusual = False
    return {
        "expected": round(mean, 4),
        "stddev": round(effective, 4),
        "zscore": round(z, 3),
        "direction": direction,
        "unusual": unusual,
        "severity": "CRITICAL" if abs(z) >= limit * 1.5 else "WARNING",
        "upper": round(mean + limit * effective, 4),
        "lower": round(max(0.0, mean - limit * effective), 4) if config.get("measure", "count") != "avg"
        else round(mean - limit * effective, 4),
    }


def annotate(points: list[dict[str, Any]], config: dict[str, Any], *, partial_last: bool = True) -> list[dict[str, Any]]:
    """The series with each point's expectation band and verdict."""
    values = [float(point["value"]) for point in points]
    out = []
    for index, point in enumerate(points):
        verdict = judge(values, index, config, partial=partial_last and index == len(points) - 1)
        out.append({**point, **({} if verdict is None else {
            "expected": verdict["expected"], "upper": verdict["upper"], "lower": verdict["lower"],
            "zscore": verdict["zscore"], "unusual": verdict["unusual"],
        })})
    return out


# ── configuration ────────────────────────────────────────────────────────


def _config(row) -> dict[str, Any]:
    return {
        "dataset": row.dataset, "measure": row.measure, "measure_field": row.measure_field,
        "date_field": row.date_field, "filters": row.filters or {}, "granularity": row.granularity,
        "method": row.method, "sensitivity": row.sensitivity, "threshold": row.threshold,
        "direction": row.direction, "window": row.window,
    }


def validated(payload: Any, *, partial: bool = False, principal=None) -> dict[str, Any]:
    """A watch definition, checked against the dataset it names."""
    if not isinstance(payload, dict):
        raise ValidationError("The watch must be a JSON object.")
    out: dict[str, Any] = {}

    def has(key: str) -> bool:
        return key in payload or not partial

    if has("name"):
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValidationError("A watch needs a name.", details={"field": "name"})
        out["name"] = name[:160]
    if "description" in payload:
        out["description"] = (str(payload.get("description") or "").strip() or None)
    if has("dataset"):
        from src.services.explorer import resource_for

        resource = resource_for(payload.get("dataset"), principal=principal)
        out["dataset"] = resource.key
    for key, allowed, default in (
        ("measure", MEASURES, "count"), ("granularity", tuple(GRANULARITIES), "day"),
        ("method", METHODS, "zscore"), ("sensitivity", tuple(SENSITIVITY), "medium"),
        ("direction", DIRECTIONS, "both"),
    ):
        if has(key):
            value = str(payload.get(key) or default).lower()
            if value not in allowed:
                raise ValidationError(f"{key} must be one of {', '.join(allowed)}.",
                                      details={"field": key, "allowed": list(allowed)})
            out[key] = value
    if "measure_field" in payload or not partial:
        out["measure_field"] = str(payload.get("measure_field") or "").strip() or None
    if "date_field" in payload or not partial:
        out["date_field"] = str(payload.get("date_field") or "").strip() or None
    if "filters" in payload or not partial:
        filters = payload.get("filters")
        filters = {} if filters is None else filters
        if not isinstance(filters, dict):
            raise ValidationError("filters must be an object.", details={"field": "filters"})
        out["filters"] = {str(k): v for k, v in filters.items() if v not in (None, "", [])}
    if "threshold" in payload:
        raw = payload.get("threshold")
        if raw in (None, ""):
            out["threshold"] = None
        else:
            try:
                value = float(raw)
            except (TypeError, ValueError) as exc:
                raise ValidationError("threshold must be a number.", details={"field": "threshold"}) from exc
            if not 0.5 <= value <= 10:
                raise ValidationError("threshold must be between 0.5 and 10.", details={"field": "threshold"})
            out["threshold"] = value
    if "window" in payload or not partial:
        try:
            window = int(payload.get("window") or 14)
        except (TypeError, ValueError) as exc:
            raise ValidationError("window must be a whole number.", details={"field": "window"}) from exc
        if not 3 <= window <= 90:
            raise ValidationError("window must be between 3 and 90 points.", details={"field": "window"})
        out["window"] = window
    if "channels" in payload or not partial:
        raw = payload.get("channels")
        channels = ["in_app"] if raw is None else raw
        if not isinstance(channels, list) or any(c not in CHANNELS for c in channels):
            raise ValidationError("channels are in_app and/or email.", details={"field": "channels"})
        out["channels"] = sorted(set(channels))
    if "recipient_ids" in payload:
        raw = payload.get("recipient_ids") or []
        if not isinstance(raw, list):
            raise ValidationError("recipient_ids must be a list.", details={"field": "recipient_ids"})
        out["recipient_ids"] = [str(parse_uuid(item, field="recipient_ids")) for item in raw]
    if "enabled" in payload:
        out["enabled"] = bool(payload.get("enabled"))
    return out


def _check_measure(config: dict[str, Any]) -> None:
    resource = _resource(config["dataset"])
    _date_field(resource, config.get("date_field"))
    if config.get("measure") in ("sum", "avg"):
        field = resource.fields.by_name.get(config.get("measure_field") or "")
        if field is None or field.kind != "number":
            raise ValidationError("A sum or an average needs a number field.",
                                  details={"field": "measure_field"})
    else:
        config["measure_field"] = None
    for key in (config.get("filters") or {}):
        name = str(key).rpartition("__")[0] if "__" in str(key) else str(key)
        for suffix in ("_min", "_max", "_from", "_to"):
            if name.endswith(suffix) and name[: -len(suffix)] in resource.fields.by_name:
                name = name[: -len(suffix)]
        if name != "q" and name not in resource.fields.by_name:
            raise ValidationError(f"{key} is not a field of {resource.label}.", details={"field": f"filters.{key}"})


# ── CRUD ─────────────────────────────────────────────────────────────────


def _load(session, watch_id: Any):
    from src.models.records_analytics import MetricWatch

    identifier = parse_uuid(watch_id, field="watch_id")
    row = session.scalars(
        select(MetricWatch).where(MetricWatch.id == identifier, MetricWatch.deleted_at.is_(None))
    ).first()
    if row is None:
        raise NotFoundError("That watch does not exist.", details={"id": str(watch_id)})
    return row


def catalogue(*, principal) -> dict[str, Any]:
    """The datasets a watch may name, with what each can be measured and dated by."""
    from src.services.explorer import resources

    principal.require(VIEW)
    datasets = []
    for resource in resources().values():
        if not principal.can(resource.permission):
            continue
        datasets.append({
            "key": resource.key,
            "label": resource.label,
            "default_date": _date_field(resource, None),
            "dates": [{"name": f.name, "label": f.title} for f in resource.fields.fields if f.kind == "datetime"],
            "numbers": [{"name": f.name, "label": f.title} for f in resource.fields.fields if f.kind == "number"],
            "filters": [
                {"name": f.name, "label": f.title, "kind": f.kind, "choices": list(f.choices)}
                for f in resource.fields.fields if f.filterable and f.kind in ("enum", "bool")
            ],
        })
    return {
        "datasets": datasets,
        "measures": list(MEASURES),
        "granularities": list(GRANULARITIES),
        "methods": list(METHODS),
        "sensitivities": [{"key": k, "threshold": v} for k, v in SENSITIVITY.items()],
        "directions": list(DIRECTIONS),
        "channels": list(CHANNELS),
        "can_manage": principal.can(MANAGE),
    }


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


def _audit_state(row) -> dict[str, Any]:
    return {**_config(row), "name": row.name, "enabled": bool(row.enabled),
            "channels": list(row.channels or [])}


# ── evaluation ───────────────────────────────────────────────────────────


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
    from src.services import notifications
    from src.services.workflows import _next_message_ref

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
            message_ref=_next_message_ref(session), subject=title[:300],
            from_name="Nucleus alerts", from_email="alerts@nucleus.local",
            to_recipients=[{"name": u.full_name, "email": u.email} for u in users],
            body_text=f"{body}\n\nOpen the alert: /alerts/{row.id}", preview=body[:400],
            folder="OUTBOX", is_read=True, priority="HIGH" if anomaly.severity == "CRITICAL" else "NORMAL",
            owner_id=row.owner_id, sent_at=now(),
        ))
        session.flush()


# ── reads ────────────────────────────────────────────────────────────────


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


def _maybe_catch_up(session) -> None:
    from src.services import analytics_jobs

    analytics_jobs.catch_up(session)
