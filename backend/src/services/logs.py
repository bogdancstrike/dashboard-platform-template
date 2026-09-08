"""The system log viewer (§22): what the platform has been doing, and why.

Read-only, like the audit ledger and for a stronger reason: these rows are
written by `core/logsink` from the outcome of a request, so a log line somebody
could edit is a log line worth nothing. There is no create, no update and no
delete — pruning is `logsink.sweep`, bounded by `retention.log_days`.

Four decisions worth stating.

**It is built on `core/query.py`, like every other list.** One declaration
drives the SQL, the sort, the facets *and* the filter vocabulary the frontend
renders, so a filter the UI offers is by construction a filter the backend
honours. The alternative — a hand-written `WHERE` per parameter — is how a
service ends up with a `service` filter the page cannot see and a `logger`
control the server ignores.

**Level filters by severity, not by equality.** "ERROR" in a log viewer means
"errors and worse", because the reason somebody chose ERROR is that they are
looking for trouble and CRITICAL is more trouble. `LOG_LEVEL` is ordered
quietest-first for exactly this, and `_at_least` slices it — so a level added
to the vocabulary is ranked by where it is put rather than by a second list
here.

**The tail is a query, not a socket.** `since` takes the newest id the caller
already has and returns only what has arrived after it, so "live" is a poll the
client controls and can pause. A WebSocket would need a broadcast from every
worker for every request — a log stream that costs more than the requests it
describes — and a viewer that reconnects on a deploy shows a gap it cannot
explain. `after`/`since` also makes the pause honest: paused is simply not
asking, and resuming asks from where it stopped.

**One line's detail is a separate read.** The list carries the message and the
outcome; the context, the stack trace and the sibling lines that share the
correlation id are fetched when a line is opened. A list that carried every
stack trace would be a page weighing megabytes for the sake of the one row
somebody expands.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Select, func, select

from src.core import vocabulary
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import Field, FieldSet, apply_filters, apply_sort, count_of, facets_for

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


def listing(session, args, *, principal) -> dict[str, Any]:
    """One page of the log, filtered and faceted in PostgreSQL (§71)."""
    principal.require(PERMISSION)
    fields = _fields()
    page = parse_page(args, default_sort="logged_at")

    statement = _apply_severity(apply_filters(_statement(), args, fields), args)
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="logged_at")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).all()

    return envelope(
        [summarise(row) for row in rows],
        total,
        page,
        fields=fields.describe(),
        facets=facets,
        columns=list(DEFAULT_COLUMNS),
    )


def tail(session, args, *, principal) -> dict[str, Any]:
    """Whatever has arrived since the caller's newest line.

    Ordered oldest-first so a client appends, and capped: see `MAX_TAIL`. The
    cursor is a line id rather than a timestamp because two lines can share a
    millisecond, and a timestamp cursor either repeats them or drops them.

    With no cursor this returns the newest page and the id to continue from, so
    a viewer's first poll and its later ones are the same call.
    """
    principal.require(PERMISSION)
    from src.models.platform import SystemLog

    fields = _fields()
    statement = _apply_severity(apply_filters(_statement(), args, fields), args)

    after = (args.get("after") or "").strip()
    if after:
        anchor = session.get(SystemLog, parse_uuid(after, field="after"))
        if anchor is None:
            # A cursor the caller cannot have got from us, or one whose line
            # has since been pruned. Refused rather than silently restarted: a
            # tail that jumped back to the beginning would replay an hour of
            # lines into somebody's viewer.
            raise NotFoundError("That line is no longer here, so the tail cannot resume from it.")
        statement = statement.where(
            (SystemLog.logged_at > anchor.logged_at)
            | ((SystemLog.logged_at == anchor.logged_at) & (SystemLog.id > anchor.id))
        )
        rows = list(
            session.scalars(
                statement.order_by(SystemLog.logged_at.asc(), SystemLog.id.asc()).limit(
                    MAX_TAIL + 1
                )
            ).all()
        )
    else:
        # Newest first to take the last page, then reversed so the caller
        # always receives oldest-first and can append without sorting.
        rows = list(
            reversed(
                session.scalars(
                    statement.order_by(
                        SystemLog.logged_at.desc(), SystemLog.id.desc()
                    ).limit(MAX_TAIL)
                ).all()
            )
        )

    more = len(rows) > MAX_TAIL
    rows = rows[:MAX_TAIL]
    return {
        "items": [summarise(row) for row in rows],
        # The cursor for the next poll: the newest line delivered, or the one
        # the caller already had when nothing is new.
        "cursor": str(rows[-1].id) if rows else (after or None),
        "more": more,
    }


def entry(session, line_id: str, *, principal) -> dict[str, Any]:
    """One line in full, with its context, its stack trace and its siblings."""
    principal.require(PERMISSION)
    from src.models.platform import SystemLog

    row = session.get(SystemLog, parse_uuid(line_id, field="id"))
    if row is None:
        raise NotFoundError("That log line does not exist.")

    return {
        **summarise(row),
        "context": row.context or {},
        "stack_trace": row.stack_trace,
        "span_id": row.span_id,
        "related": _related(session, row),
    }


def _related(session, row) -> list[dict[str, Any]]:
    """The other lines from the same request.

    This is what makes a correlation id worth storing: one failure is rarely
    one line, and reading "permission denied" without the request that caused
    it is reading half the story. Empty when the line has no id rather than
    matching every line that also has none.
    """
    from src.models.platform import SystemLog

    if not row.correlation_id:
        return []
    rows = session.scalars(
        select(SystemLog)
        .where(SystemLog.correlation_id == row.correlation_id, SystemLog.id != row.id)
        .order_by(SystemLog.logged_at.asc())
        .limit(MAX_RELATED)
    ).all()
    return [summarise(sibling) for sibling in rows]


def prune(session, args, *, principal) -> dict[str, Any]:
    """Apply the retention policy now, rather than waiting for the schedule.

    `logs.view` reads; deleting needs `settings.manage`, because the bound
    being applied is a *setting* and somebody who may not change it should not
    be able to enact it early either. The number of days is not a parameter:
    taking it from the request would make this an arbitrary delete endpoint
    wearing a retention policy's name.
    """
    principal.require(PERMISSION, "settings.manage")
    from src.core import logsink

    days = _retention(session)
    if days is None:
        raise ValidationError(
            "There is no retention policy to apply — `retention.log_days` is not set."
        )
    removed = logsink.sweep(session, days=days)
    return {"removed": removed, "retention_days": days, "kept": count_of(session, _statement())}

