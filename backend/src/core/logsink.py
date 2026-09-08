"""The platform's own request log, written to the table `/admin/logs` reads.

Without this the log viewer is a table of fiction: the seed writes two hundred
plausible lines whose correlation ids match nothing, so the one thing a log
console exists for — somebody pastes the id from an error screen and finds the
request — cannot be demonstrated at all. The id already exists, `core/errors`
already puts it in every failure payload and the frontend already prints it on
its error screens; this closes the loop.

Four decisions, each of which is the difference between a log sink and an
outage.

**It never affects the response.** The row is written in its own session after
the response is built, and every failure inside is swallowed. A logging table
that is full, locked or gone must not turn a working request into a 500 — and
the request has already succeeded by the time this runs, so there is nothing
left to fail into.

**It is not in the request's transaction.** A rolled-back request is exactly
the one worth having a log line for; sharing its session would delete the
evidence with the cause.

**It logs requests, not chatter.** Health probes answer every few seconds from
the container's own health check, and the log endpoints themselves would each
write a line about being read — a table that grows when somebody looks at it,
and a live tail that never settles because it keeps reporting itself. Both are
excluded by prefix.

**Level comes from the outcome, not from the caller.** `>=500` is ERROR, `>=400`
is WARNING, a slow success is WARNING too, and everything else is INFO — so
filtering by level answers "what went wrong" rather than "what did somebody
choose to call important".

Retention is `retention.log_days`, which was a seeded setting before there was
anything writing rows for it to bound. Pruning is `sweep()`, called from the
same place a deployment would call any other periodic job.
"""

from __future__ import annotations

from typing import Any

from flask import g, request

from src.config import Config

#: Prefixes that are never logged.
#:
#: The health probes because the container asks every few seconds and would
#: bury everything else; the log endpoints because a viewer that writes a line
#: about each of its own reads is a table that grows while being looked at, and
#: a tail that never goes quiet. `/metrics` for the same reason as health.
#: Derived from `API_PREFIX` rather than written as "/platform", because a
#: deployment that moves the prefix would otherwise silently start logging its
#: own health probes and its own log reads.
_PREFIX = Config.API_PREFIX.rstrip("/")

IGNORED_PREFIXES: tuple[str, ...] = (
    f"{_PREFIX}/health",
    f"{_PREFIX}/admin/logs",
    # The live channel, which is a *socket* and not a request. Its "duration"
    # is how long somebody left the page open: the first version of this sink
    # logged three of them at sixteen seconds, and a demo left open would have
    # written a WARNING claiming a request took an hour. That floods the
    # slow-request heuristic and makes the level column mean nothing — found by
    # reading the real traffic this sink produced, which is the only place it
    # was visible.
    f"{_PREFIX}/live",
    "/metrics",
    "/swagger",
    "/static",
)

#: Above this, a request that *worked* is still worth a warning. Chosen to sit
#: well clear of the slowest legitimate read (the analysis compiler's
#: four-`GROUP BY` query) so this flags a problem rather than a busy page.
SLOW_MILLISECONDS = 2_000

def level_for(status_code: int, duration_ms: float) -> str:
    """The level a finished request earns.

    Derived rather than passed in, so "ERROR" in this table always means the
    same thing. A caller-chosen level makes the level column a matter of taste
    and the filter beside it useless.
    """
    if status_code >= 500:
        return "ERROR"
    if status_code >= 400:
        return "WARNING"
    if duration_ms >= SLOW_MILLISECONDS:
        return "WARNING"
    return "INFO"


def install(app) -> None:
    """Attach the sink to a Flask app.

    Uses `after_request` to *capture* and `teardown_request` to *write*: at
    `after_request` the response exists but the request's own session may still
    be open, and writing there would interleave two transactions on one
    connection under gevent.
    """
    from time import perf_counter

    @app.before_request
    def _mark_start() -> None:
        g.request_started = perf_counter()

    @app.after_request
    def _capture(response):
        try:
            g.request_log = _describe(response.status_code)
        except Exception:  # noqa: BLE001 - a log line is never worth a 500
            g.request_log = None
        return response

    @app.teardown_request
    def _write(_exception) -> None:
        row = getattr(g, "request_log", None)
        if row is None:
            return
        try:
            record(row)
        except Exception:  # noqa: BLE001 - see the module docstring
            # Guarded here as well as inside `record`, and not because one of
            # them is redundant: an exception raised in `teardown_request`
            # propagates out of `ctx.pop` and fails a request that had already
            # succeeded. Trusting the callee to be safe leaves the whole
            # application one refactor away from an outage, and this is the
            # boundary where "a log line is never worth a 500" has to hold.
            pass


def _describe(status_code: int) -> dict[str, Any] | None:
    """The row a finished request deserves, or `None` if it is not logged."""
    from time import perf_counter

    path = request.path or ""
    if any(path.startswith(prefix) for prefix in IGNORED_PREFIXES):
        return None

    started = getattr(g, "request_started", None)
    duration_ms = (perf_counter() - started) * 1000 if started else 0.0

    # `g.principal` is set by the auth decorator, so an unauthenticated request
    # simply has no user — which is itself worth being able to filter on.
    principal = getattr(g, "principal", None)
    user_id = getattr(principal, "user_id", None) if principal else None

    return {
        "level": level_for(status_code, duration_ms),
        "service": Config.SERVICE_NAME,
        "logger": "api.request",
        "message": f"{request.method} {path} → {status_code}",
        "correlation_id": getattr(g, "correlation_id", None) or None,
        "trace_id": _trace_id(getattr(g, "traceparent", None)),
        "user_id": user_id,
        "environment": Config.ENVIRONMENT,
        "duration_ms": round(duration_ms, 2),
        "status_code": status_code,
        # Deliberately small: the method, the route and the query string are
        # what make a line reproducible, and a log row that copied the request
        # *body* would put whatever somebody typed into a table with a
        # different permission on it.
        "context": {
            "method": request.method,
            "path": path,
            "query": request.query_string.decode("utf-8", "replace")[:500] or None,
            "route": str(request.url_rule) if request.url_rule else None,
            "referrer": (request.referrer or None),
        },
    }


def _trace_id(traceparent: str | None) -> str | None:
    """The trace id out of a W3C `traceparent`, if the caller sent one.

    Version-prefixed and dash-separated: `00-<trace>-<span>-<flags>`. Parsed
    defensively — a malformed header from some caller's SDK must not stop the
    line being written.
    """
    if not traceparent:
        return None
    parts = traceparent.split("-")
    return parts[1] if len(parts) >= 3 and len(parts[1]) == 32 else None


def record(row: dict[str, Any]) -> None:
    """Write one line, in its own transaction, swallowing everything.

    Separate from `_describe` so a test can write a line without a request
    context, and so the one place that touches the database is the one place
    that has to be safe.
    """
    try:
        from src.core.db import session_scope
        from src.models.platform import SystemLog

        with session_scope() as session:
            session.add(SystemLog(logged_at=_now(), **row))
    except Exception:  # noqa: BLE001 - see the module docstring
        pass


def _now():
    from src.core.clock import now

    return now()


def sweep(session, *, days: int) -> int:
    """Delete lines older than `days`, returning how many went.

    The bound is `retention.log_days`, read by the caller rather than here: a
    function that read the setting itself could not be tested against a value
    the database does not hold.
    """
    from datetime import timedelta

    from src.core.clock import now
    from src.models.platform import SystemLog

    if days <= 0:
        raise ValueError("retention must be at least one day")

    cutoff = now() - timedelta(days=days)
    result = session.execute(
        SystemLog.__table__.delete().where(SystemLog.logged_at < cutoff)
    )
    return int(result.rowcount or 0)
