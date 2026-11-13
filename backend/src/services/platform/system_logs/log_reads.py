"""The log list, its tail, one line with its neighbours, and pruning."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import apply_filters, apply_sort, count_of, facets_for
from src.core.repository import get_or_404
from src.services.platform.system_logs.log_filters import (
    DEFAULT_COLUMNS,
    MAX_RELATED,
    MAX_TAIL,
    PERMISSION,
    _apply_severity,
    _fields,
    _retention,
    _statement,
    summarise,
)


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

    row = get_or_404(
        session, SystemLog, parse_uuid(line_id, field="id"), "That log line does not exist."
    )

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
