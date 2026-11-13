"""Dependency probes behind the health endpoints and the system-health page.

Three levels, because three different callers ask three different questions:

* **liveness** — is this process running? No I/O at all. A liveness probe that
  touches the database restarts a healthy API every time the database hiccups,
  which turns a brief outage into a crash loop.
* **readiness** — can this process serve a request? The database must answer;
  the cache must not, because `core/cache.py` degrades to a miss by design.
* **snapshot** — everything, with latency and last error, for §24.
"""

from __future__ import annotations

import os
import platform
import socket
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select

from src.config import Config
from src.core.clock import iso, now

#: Wall-clock at import, which is process start for every practical purpose.
_STARTED_AT = now()
_STARTED_MONOTONIC = time.monotonic()


def uptime_seconds() -> float:
    return round(time.monotonic() - _STARTED_MONOTONIC, 3)


def liveness() -> dict[str, Any]:
    return {
        "status": "healthy",
        "service": Config.SERVICE_NAME,
        "environment": Config.ENVIRONMENT,
        "started_at": iso(_STARTED_AT),
        "uptime_seconds": uptime_seconds(),
        "checked_at": iso(now()),
    }


def probe_database() -> dict[str, Any]:
    """`SELECT 1` plus the pool's own accounting.

    The pool numbers are the useful half: a database that answers in 2ms while
    every connection is checked out is a database about to look very slow.
    """
    from sqlalchemy import text

    from src.core.db import get_engine

    started = time.perf_counter()
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        latency = round((time.perf_counter() - started) * 1000, 2)
        pool = engine.pool
        detail: dict[str, Any] = {"status": "healthy", "latency_ms": latency}
        # Not every pool implementation carries these (NullPool in tests).
        for name in ("size", "checkedin", "checkedout", "overflow"):
            probe = getattr(pool, name, None)
            if callable(probe):
                try:
                    detail[f"pool_{name}"] = probe()
                except Exception:  # pragma: no cover - diagnostics only
                    pass
        return detail
    except Exception as exc:
        return {
            "status": "unavailable",
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            "error": str(exc)[:300],
        }


def probe_cache() -> dict[str, Any]:
    from src.core import cache

    return cache.health()


def probe_storage() -> dict[str, Any]:
    """Object storage, and *which* store is answering.

    The name matters as much as the status: the local-directory fallback works
    on a laptop and streams every byte through this process, which is a trade
    nobody should be making in a deployment without knowing it.
    """
    from src.core import storage

    # Named from the configuration rather than from the store object, so the
    # snapshot still says *which* store failed when building it is what failed.
    # It reported only "unavailable" before, which tells an operator that
    # something is wrong and nothing about where to look — and the local
    # fallback's directory being unwritable is exactly that case.
    configured = "object" if Config.STORAGE_ENDPOINT else "local"
    try:
        store = storage.for_config()
        return {"store": store.name, **store.health()}
    except Exception as exc:
        return {
            "store": configured,
            "status": "unavailable",
            "latency_ms": None,
            "error": str(exc)[:300],
        }


def probe_auth() -> dict[str, Any]:
    """Reaches Keycloak for the realm keys, so it is deliberately not part of
    readiness: the API serves cached-key traffic perfectly well while the
    identity provider restarts."""
    from src.core.auth import auth_health

    return auth_health()


def readiness() -> tuple[dict[str, Any], bool]:
    """The report, and whether the process should accept traffic."""
    database = probe_database()
    cache_state = probe_cache()
    ready = database["status"] == "healthy"
    return (
        {
            "status": "ready" if ready else "not_ready",
            "service": Config.SERVICE_NAME,
            "environment": Config.ENVIRONMENT,
            "uptime_seconds": uptime_seconds(),
            "checked_at": iso(now()),
            "checks": {
                "database": database,
                # Reported so a degraded cache is visible, but never fatal.
                "cache": cache_state,
            },
        },
        ready,
    )


def snapshot(*, include_auth: bool = True) -> dict[str, Any]:
    """Everything §24 renders: each dependency, plus who is reporting it."""
    checks = {
        "database": probe_database(),
        "cache": probe_cache(),
        "storage": probe_storage(),
    }
    if include_auth:
        checks["identity"] = probe_auth()

    degraded = [name for name, state in checks.items() if state.get("status") == "unavailable"]
    critical = "database" in degraded
    return {
        "status": "unhealthy" if critical else "degraded" if degraded else "healthy",
        "degraded": degraded,
        "service": Config.SERVICE_NAME,
        "environment": Config.ENVIRONMENT,
        "version": Config.APP_VERSION,
        "host": socket.gethostname(),
        "pid": os.getpid(),
        "python": platform.python_version(),
        "started_at": iso(_STARTED_AT),
        "uptime_seconds": uptime_seconds(),
        "checked_at": iso(now()),
        "checks": checks,
    }


# ── what was healthy, when (§24) ─────────────────────────────────────────
#
# The snapshot above answers "is it working *now*", which is the question a
# deploy pipeline asks. The question a person on the health page is asking is
# almost always the other one: **was it working at four o'clock**, when the
# thing they are investigating happened. A page that can only say "healthy"
# cannot answer it, and the incident is then reconstructed from memory.
#
# The history is already recorded, per service, on `service_health.history` —
# and until now nothing served it.

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


def _incidents(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Consecutive not-healthy points, collapsed into periods."""
    out: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for point in points:
        if point["status"] == "HEALTHY":
            current = None
            continue
        if current and current["status"] == point["status"]:
            current["ended_at"] = iso(point["at"])
            current["points"] += 1
            continue
        current = {
            "status": point["status"],
            "started_at": iso(point["at"]),
            "ended_at": iso(point["at"]),
            "points": 1,
        }
        out.append(current)
    return out


def _uptime(points: list[dict[str, Any]]) -> float:
    if not points:
        return 0.0
    healthy = sum(1 for point in points if point["status"] == "HEALTHY")
    return round(healthy * 100 / len(points), 2)
