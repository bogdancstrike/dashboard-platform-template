"""The health history: one series per service over a window."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select

from src.core.clock import iso, now
from src.services.platform.health.incidents import _incidents, _uptime

#: The windows the page offers, and how far back each looks.
PERIODS: dict[str, int] = {
    "8h": 8,
    "1d": 24,
    "7d": 24 * 7,
    "30d": 24 * 30,
}


#: Points past this and a line chart is a smear. Longer windows are bucketed
#: rather than truncated, because dropping the *end* of a window answers a
#: different question from the one that was asked.
MAX_POINTS = 180


def history(session, args, *, principal) -> dict[str, Any]:
    """Every monitored service, and what it was doing across a window.

    Bucketed by an interval chosen from the window, so eight hours is drawn
    at its own resolution and thirty days is drawn at a readable one. A bucket
    takes the **worst** status in it and the **mean** latency: an outage that
    lasted twenty minutes inside an hourly bucket is an outage, and averaging
    statuses would round it away — which is precisely the reading somebody is
    on this page to avoid.
    """
    from src.models.platform import ServiceHealth

    principal.require("health.view")
    period, since, until = _window(args)

    rows = session.scalars(
        select(ServiceHealth).order_by(ServiceHealth.category, ServiceHealth.name)
    ).all()

    services = [_service_history(row, since, until) for row in rows]
    return {
        "period": period,
        "from": iso(since),
        "to": iso(until),
        "periods": sorted(PERIODS, key=lambda key: PERIODS[key]),
        "services": services,
        # Counted over the window rather than over "now", because the page's
        # own headline should agree with the charts underneath it.
        "counts": {
            "services": len(services),
            "healthy_now": sum(1 for row in rows if row.status == "HEALTHY"),
            "incidents": sum(len(service["incidents"]) for service in services),
        },
    }


def _window(args) -> tuple[str, Any, Any]:
    """The window asked for: a named period, or an explicit pair of moments.

    A custom range is two ISO moments. Anything unparseable falls back to the
    default period rather than being refused: a health page that answers a
    malformed query with a 400 is a health page somebody cannot use during the
    incident it exists for.
    """
    args = args or {}
    until = now()
    raw_from = str(args.get("from") or "").strip()
    raw_to = str(args.get("to") or "").strip()

    if raw_from:
        started = _moment(raw_from)
        ended = _moment(raw_to) or until
        if started and ended > started:
            return "custom", started, ended

    period = str(args.get("period") or "1d").strip()
    hours = PERIODS.get(period)
    if hours is None:
        period, hours = "1d", PERIODS["1d"]
    return period, until - timedelta(hours=hours), until


def _moment(raw: str):
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _service_history(row, since, until) -> dict[str, Any]:
    """One service's series and its incidents, inside the window."""
    points = []
    for entry in row.history or []:
        at = _moment(str(entry.get("at") or ""))
        if at is None or at < since or at > until:
            continue
        points.append({
            "at": at,
            "status": str(entry.get("status") or "UNKNOWN"),
            "latency_ms": float(entry.get("latency_ms") or 0),
        })
    points.sort(key=lambda point: point["at"])

    bucketed = _bucket(points, since, until)
    return {
        "key": row.key,
        "name": row.name,
        "category": row.category,
        "status": row.status,
        "latency_ms": float(row.latency_ms or 0),
        "uptime_percent": float(row.uptime_percent or 0),
        "message": row.message,
        "last_checked_at": iso(row.last_checked_at) if row.last_checked_at else None,
        "series": [
            {"at": iso(point["at"]), "status": point["status"], "latency_ms": point["latency_ms"]}
            for point in bucketed
        ],
        # Runs of not-healthy, as periods rather than as points: "unavailable
        # at 04:00, 05:00 and 06:00" is one incident, and listing it three
        # times is how a page makes an outage look like three.
        "incidents": _incidents(bucketed),
        # Over the *window*, and named as such — the column on the row is a
        # lifetime figure and the two disagreeing without saying so is how a
        # number gets quoted wrongly.
        "window_uptime_percent": _uptime(bucketed),
    }


def _bucket(points: list[dict[str, Any]], since, until) -> list[dict[str, Any]]:
    """At most `MAX_POINTS`, by taking the worst status and the mean latency."""
    if len(points) <= MAX_POINTS:
        return points
    span = (until - since).total_seconds() or 1
    width = span / MAX_POINTS
    buckets: dict[int, list[dict[str, Any]]] = {}
    for point in points:
        index = int((point["at"] - since).total_seconds() // width)
        buckets.setdefault(index, []).append(point)

    out = []
    for index in sorted(buckets):
        group = buckets[index]
        out.append({
            "at": group[0]["at"],
            # The worst, not the commonest: an outage inside a bucket is an
            # outage, and a majority vote rounds it away.
            "status": min(group, key=lambda point: _RANK.get(point["status"], 0))["status"],
            "latency_ms": sum(point["latency_ms"] for point in group) / len(group),
        })
    return out


#: Worst first, so `min` picks the worst status in a bucket.
_RANK = {"UNAVAILABLE": 0, "DEGRADED": 1, "UNKNOWN": 2, "HEALTHY": 3}
