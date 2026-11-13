"""One window of the calendar: occurrences, clashes and counts."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from src.core.clock import iso
from src.core.errors import ValidationError
from src.core.vocabulary import EVENT_CATEGORY, EVENT_RESPONSE, EVENT_STATUS
from src.models.business import CalendarEvent
from src.services.work.calendar.recurrence import (
    MANAGE,
    MAX_WINDOW_DAYS,
    VIEW,
    Occurrence,
    _expand,
    _involves,
    _moment,
    _response_of,
)
from src.services.work.calendar.serializers import _occurrence


def window(session, args, *, principal) -> dict[str, Any]:
    """Every occurrence between `from` and `to`, expanded and ordered.

    The counts and the clash detection are over the whole window rather than
    over a page: a calendar is not paginated, and a month with more events than
    fit is a month whose filters need using.
    """
    principal.require(VIEW)
    start, end = _window_bounds(args)

    statement = (
        select(CalendarEvent)
        .options(selectinload(CalendarEvent.organizer))
        .where(
            CalendarEvent.deleted_at.is_(None),
            # A series can only reach the window if it starts before the end of
            # it — true for single events and recurring ones alike.
            CalendarEvent.starts_at < end,
            # And it must not have finished before the window began. For a
            # series that is `recurrence_until`, which the model materialises
            # so this stays a range scan (§71).
            or_(
                CalendarEvent.recurrence_until >= start,
                CalendarEvent.ends_at >= start,
            ),
        )
    )

    category = str(args.get("category") or "").strip().upper()
    if category:
        if category not in EVENT_CATEGORY:
            raise ValidationError(
                "Unknown category.",
                details={"category": category, "allowed": list(EVENT_CATEGORY)},
            )
        statement = statement.where(CalendarEvent.category == category)

    if str(args.get("hide_cancelled") or "") in ("1", "true", "True"):
        statement = statement.where(CalendarEvent.status != "CANCELLED")

    rows = session.scalars(statement).unique().all()

    mine = str(args.get("mine") or "") in ("1", "true", "True")
    me = getattr(principal, "user_id", None)
    if mine and me is not None:
        rows = [row for row in rows if _involves(row, me)]

    occurrences: list[Occurrence] = []
    for row in rows:
        occurrences.extend(_expand(row, start, end))
    occurrences.sort(key=lambda item: (item.starts_at, item.event.title))

    clashes = _clashes(occurrences, me)
    serialised = [
        _occurrence(item, principal, clash=clashes.get(item.id, ())) for item in occurrences
    ]

    return {
        "from": iso(start),
        "to": iso(end),
        "items": serialised,
        "total": len(serialised),
        "counts": _counts(occurrences, me),
        "categories": list(EVENT_CATEGORY),
        "statuses": list(EVENT_STATUS),
        "responses": list(EVENT_RESPONSE),
        "can_manage": principal.can(MANAGE),
    }


def _window_bounds(args) -> tuple[datetime, datetime]:
    """The requested window, validated.

    Both ends are required. A calendar endpoint that defaulted to "everything"
    would answer a request for a month view by expanding every series the
    database holds, which is the one shape this module exists to avoid.
    """
    start = _moment(args.get("from"), "from")
    end = _moment(args.get("to"), "to")
    if end <= start:
        raise ValidationError("`to` has to come after `from`.")
    if (end - start).days > MAX_WINDOW_DAYS:
        raise ValidationError(
            f"A calendar window is at most {MAX_WINDOW_DAYS} days. "
            "For a longer span, ask the analysis endpoint instead.",
            details={"days": (end - start).days},
        )
    return start, end


def _clashes(occurrences: list[Occurrence], me: UUID | None) -> dict[str, tuple[str, ...]]:
    """Which of *this reader's* occurrences overlap each other.

    A clash is a fact about a person, not about a pair of events: the same two
    meetings are a problem for the two people in both and no business of
    anybody else's. So this is computed over the window that was asked for, for
    the person who asked — and never stored.

    Linear over a sorted list rather than every pair: a month with two hundred
    occurrences is 20,000 comparisons the naive way, on every month a reader
    pages through.
    """
    if me is None:
        return {}
    theirs = [
        item
        for item in occurrences
        if _involves(item.event, me) and item.event.status != "CANCELLED"
    ]
    found: dict[str, list[str]] = {}
    for index, item in enumerate(theirs):
        for other in theirs[index + 1 :]:
            if other.starts_at >= item.ends_at:
                # Sorted by start, so nothing after this one can overlap either.
                break
            if item.event.all_day or other.event.all_day:
                # An all-day marker is not a double booking. A public holiday
                # clashing with every meeting in it would flag the whole week.
                continue
            found.setdefault(item.id, []).append(other.event.title)
            found.setdefault(other.id, []).append(item.event.title)
    return {key: tuple(value) for key, value in found.items()}


def _counts(occurrences: list[Occurrence], me: UUID | None) -> dict[str, Any]:
    """What the window adds up to, computed over all of it (§44)."""
    by_category: dict[str, int] = {}
    mine = 0
    awaiting = 0
    for item in occurrences:
        by_category[item.event.category] = by_category.get(item.event.category, 0) + 1
        if me is not None and _involves(item.event, me):
            mine += 1
            if _response_of(item.event, me) == "NEEDS_ACTION":
                awaiting += 1
    return {
        "total": len(occurrences),
        "mine": mine,
        # The number that is actually a to-do list: invitations nobody has
        # answered are the only calendar count worth acting on.
        "awaiting_response": awaiting,
        "by_category": by_category,
    }
