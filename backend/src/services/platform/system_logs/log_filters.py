"""Log permissions, columns, severity filters and retention."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Select, func, select

from src.core import vocabulary
from src.core.errors import ValidationError
from src.core.query import Field, FieldSet, count_of

#: Reading the logs is its own privilege and a narrow one: a log line names an
#: address, a user id and whatever a failure said, so this is not something
#: everybody who may see the health page should hold.
PERMISSION = "logs.view"


#: How many sibling lines one entry's detail carries. A correlation id on a
#: slow page can gather dozens of requests; twenty is enough to see the shape
#: of what happened and few enough to render in a pane.
MAX_RELATED = 20


#: The most a single tail poll returns. A client that has been paused for an
#: hour asks for everything since its last id, and the honest answer is "here
#: is the newest page and there are more" rather than a response that takes a
#: minute to build.
MAX_TAIL = 200


def _fields() -> FieldSet:
    """Built lazily so importing this module does not pull the models at boot."""
    from src.models.platform import SystemLog

    return FieldSet(
        Field("logged_at", SystemLog.logged_at, kind="datetime", label="When"),
        Field("level", SystemLog.level, kind="enum", facet=True,
              choices=vocabulary.LOG_LEVEL),
        Field("service", SystemLog.service, kind="enum", facet=True),
        Field("logger", SystemLog.logger, kind="enum", facet=True, searchable=True),
        Field("message", SystemLog.message, searchable=True),
        Field("environment", SystemLog.environment, kind="enum", facet=True),
        Field("host", SystemLog.host, kind="enum", facet=True),
        Field("status_code", SystemLog.status_code, kind="number", label="Status"),
        Field("duration_ms", SystemLog.duration_ms, kind="number", label="Duration (ms)"),
        # Searchable so pasting an id from an error screen into the one search
        # box finds the request — which is the whole point of the column.
        Field("correlation_id", SystemLog.correlation_id, searchable=True,
              label="Correlation ID"),
        Field("trace_id", SystemLog.trace_id, searchable=True, label="Trace ID"),
        Field("user_id", SystemLog.user_id, kind="uuid", label="User ID"),
        Field("id", SystemLog.id, kind="uuid", label="Line ID"),
    )


#: What the table shows before anybody configures it: when, how bad, where
#: from, and what happened. `duration_ms` and `status_code` earn their place
#: because this table's most common question is "which request was slow".
DEFAULT_COLUMNS = ("logged_at", "level", "service", "logger", "message")


def _statement() -> Select:
    from src.models.platform import SystemLog

    return select(SystemLog)


def _at_least(level: str) -> tuple[str, ...]:
    """`level` and everything worse than it.

    A slice of the vocabulary rather than a second ordering, so a level added
    there is ranked by where it was put. An unknown level is refused with the
    known ones named — silently returning nothing would read as "no errors".
    """
    try:
        index = vocabulary.LOG_LEVEL.index(level)
    except ValueError:
        raise ValidationError(
            f"{level!r} is not a log level.",
            details={"value": level, "allowed": list(vocabulary.LOG_LEVEL)},
        ) from None
    return vocabulary.LOG_LEVEL[index:]


def _apply_severity(statement: Select, args) -> Select:
    """Honour `min_level`, the one filter `apply_filters` cannot express."""
    from src.models.platform import SystemLog

    minimum = (args.get("min_level") or "").strip().upper()
    if not minimum:
        return statement
    return statement.where(SystemLog.level.in_(_at_least(minimum)))


def summarise(row) -> dict[str, Any]:
    """One line, as a table row.

    No `context` and no `stack_trace`: see the module docstring. `duration_ms`
    is `Numeric` in the model, which serialises as a string unless it is made a
    float here — and a duration that sorts as text puts 9ms after 1000ms.
    """
    return {
        "id": str(row.id),
        "logged_at": row.logged_at.isoformat() if row.logged_at else None,
        "level": row.level,
        "service": row.service,
        "logger": row.logger,
        "message": row.message,
        "correlation_id": row.correlation_id,
        "trace_id": row.trace_id,
        "user_id": str(row.user_id) if row.user_id else None,
        "host": row.host,
        "environment": row.environment,
        "duration_ms": float(row.duration_ms) if row.duration_ms is not None else None,
        "status_code": row.status_code,
        # So a table can mark the expandable rows without fetching either.
        "has_context": bool(row.context),
        "has_stack_trace": bool(row.stack_trace),
    }


def catalogue(session, *, principal) -> dict[str, Any]:
    """The filter vocabulary, from the same declaration the SQL is built from."""
    principal.require(PERMISSION)
    from src.models.platform import SystemLog

    fields = _fields()
    # The counts per level, over everything rather than over the current
    # filter: they are what the level chips show, and a chip whose number
    # changed when you clicked it would be a chip nobody trusts (§71).
    counts = dict(
        session.execute(
            select(SystemLog.level, func.count()).group_by(SystemLog.level)
        ).all()
    )
    return {
        "fields": fields.describe(),
        "default_columns": list(DEFAULT_COLUMNS),
        "default_sort": "logged_at",
        "levels": [
            {"key": level, "count": int(counts.get(level, 0))}
            for level in vocabulary.LOG_LEVEL
        ],
        "retention_days": _retention(session),
        "total": count_of(session, _statement()),
    }


def _retention(session) -> int | None:
    """What `retention.log_days` says, or `None` if it has not been seeded.

    Read from the settings table rather than declared here: it is the same row
    `/admin/settings` edits, and a viewer that told somebody "kept for 30 days"
    while the setting said 90 would be a viewer lying about their own data.
    """
    from src.models.platform import SystemSetting

    row = session.scalar(
        select(SystemSetting).where(SystemSetting.key == "retention.log_days")
    )
    if row is None:
        return None
    value = (row.value or {}).get("value")
    return int(value) if isinstance(value, (int, float)) else None
