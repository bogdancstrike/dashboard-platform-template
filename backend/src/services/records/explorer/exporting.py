"""An export, run from its plan: columns, rows, the whole file."""

from __future__ import annotations

from typing import Any

from src.services.records.explorer.plans import Plan, plan_for, statement_of
from src.services.records.explorer.querying import _serialize


def columns_of(plan: Plan) -> list[Any]:
    """The file's header, labelled as the field catalogue labels it."""
    from src.core import export as writer

    fields = plan.resource.fields.by_name
    return [writer.Column(name, fields[name].title) for name in plan.columns]


def rows_of(plan: Plan, rows: Any) -> Any:
    """Each row as the file wants it: a generator, so nothing is accumulated."""
    resource = plan.resource
    names = list(plan.columns)
    return (_serialize(row, resource, names) for row in rows)


def export(payload: dict[str, Any], *, principal):
    """The current exploration as a file (§30).

    The same statement `run` builds, minus its page — so the download is
    provably the question on screen rather than a second, similar query that
    will drift from it. Not handed a session: the rows stream after this
    returns and open one of their own.
    """
    from src.core import export as writer

    plan = plan_for(payload, principal=principal)
    statement = statement_of(plan)
    # Counted before a byte is written: a download that stopped at the ceiling
    # used to arrive as a plausible-looking fragment with a 200 on it. Above the
    # ceiling this raises, and the message says to queue it instead (§30).
    writer.refuse_if_truncated(statement, fmt=plan.fmt, what=plan.resource.label.lower())
    rows = writer.stream_rows(statement, limit=writer.limit_for(plan.fmt))
    return writer.response(
        rows_of(plan, rows),
        columns_of(plan),
        fmt=plan.fmt,
        stem=plan.resource_type,
    )
