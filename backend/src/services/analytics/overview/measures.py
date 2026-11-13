"""Periods, period-over-period change, and the live-row counts and series every panel uses."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, or_, select

#: The named ranges the period picker offers.
PERIODS: tuple[tuple[str, str], ...] = (
    ("today", "Today"),
    ("yesterday", "Yesterday"),
    ("last_7_days", "Last 7 days"),
    ("last_30_days", "Last 30 days"),
    ("last_90_days", "Last 90 days"),
    ("current_month", "This month"),
    ("previous_month", "Last month"),
    ("current_year", "This year"),
    ("previous_year", "Last year"),
    ("custom", "Custom range"),
)


def _change(current: float, previous: float) -> dict[str, Any]:
    """Percentage movement, and whether the movement is up or down.

    `direction` is left to the caller: more revenue is good, more failed jobs is
    not, and a tile that colours every increase green is a tile that reads
    "record number of outages" as good news.
    """
    if previous in (0, None):
        percent = 100.0 if current else 0.0
    else:
        percent = (current - previous) / abs(previous) * 100.0
    return {
        "previous": round(previous, 2) if isinstance(previous, float) else previous,
        "change_percent": round(percent, 1),
        "trend": "up" if current > previous else "down" if current < previous else "flat",
    }


def _kpi(
    key: str,
    label: str,
    value: float,
    previous: float,
    *,
    icon: str,
    accent: str,
    link: str,
    hint: str = "",
    unit: str = "",
    #: "up_is_good" | "down_is_good" | "neutral" — how to colour the movement.
    polarity: str = "up_is_good",
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "value": round(value, 2) if isinstance(value, float) else value,
        "unit": unit,
        "icon": icon,
        "accent": accent,
        "link": link,
        "hint": hint,
        "polarity": polarity,
        **_change(float(value or 0), float(previous or 0)),
    }


def _entity_of(expression):
    """The mapped class an expression belongs to, or None for `func.count()`."""
    return getattr(getattr(expression, "parent", None), "class_", None)


def _live(*expressions) -> tuple:
    """"Not deleted", derived from whatever the query is over.

    A soft delete means gone from every list and remembered only by the audit
    trail — and the front page counted them anyway. `open_tickets` was
    `~status.in_(("RESOLVED", "CLOSED"))` and nothing else, so every ticket
    anybody had ever deleted was still open on the dashboard: 189 where the
    table showed 50. Fourteen of the queries here *did* remember the filter and
    the rest did not, which is worse than uniformly wrong — two numbers on one
    page disagreeing about whether a record exists.
    
    So the rule is derived from the model rather than remembered per query. A
    new aggregate gets it by construction, and a dataset without a
    `deleted_at` contributes nothing.
    """
    clauses = []
    seen: set = set()
    for expression in expressions:
        model = expression if isinstance(expression, type) else _entity_of(expression)
        if model is None or model in seen:
            continue
        seen.add(model)
        deleted = getattr(model, "deleted_at", None)
        if deleted is not None:
            clauses.append(deleted.is_(None))
    return tuple(clauses)


def _count(session, model, *clauses) -> int:
    stmt = select(func.count()).select_from(model)
    for clause in (*_live(model), *clauses):
        stmt = stmt.where(clause)
    return session.scalar(stmt) or 0


def _sum(session, column, *clauses) -> float:
    stmt = select(func.coalesce(func.sum(column), 0))
    for clause in (*_live(column), *clauses):
        stmt = stmt.where(clause)
    return float(session.scalar(stmt) or 0)


def _open_at(session, model, created, closed, moment: datetime, *clauses) -> int:
    """How many rows were *open at* a moment — not how many existed by then.

    The distinction is the whole comparison. Counting rows created before the
    previous period ended answers "how many tickets had ever been raised",
    which only ever goes up, and makes every backlog look like it exploded.
    What a reader wants is the backlog as it stood: opened before that moment
    and not yet closed by it.
    """
    return _count(
        session,
        model,
        created < moment,
        or_(closed.is_(None), closed >= moment),
        *clauses,
    )
