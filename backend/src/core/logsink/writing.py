"""Writing a request's log line, and sweeping old ones."""

from __future__ import annotations

from typing import Any


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
