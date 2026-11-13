"""Expanding events into occurrences: single events, weekly and monthly series."""

from __future__ import annotations

import calendar as calendar_module
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from src.core.errors import ValidationError
from src.core.vocabulary import EVENT_FREQUENCY
from src.models.business import CalendarEvent

#: Reading the calendar and writing to it are separate privileges: everybody
#: needs to know what is happening, and not everybody should be able to put
#: something in somebody else's week.
VIEW = "calendar.view"


MANAGE = "calendar.manage"


#: The widest window one request will answer. A year of a daily series is 365
#: occurrences per event and a request for a decade is not a calendar view —
#: it is a report, and `/api/analysis/run` is where those live.
MAX_WINDOW_DAYS = 400


#: Occurrences one series will contribute to one window. A daily series across
#: the maximum window reaches 400, so this only bites on a malformed rule —
#: which is the case worth bounding.
MAX_OCCURRENCES = 500


#: RRULE weekday codes, in the order `date.weekday()` numbers them.
WEEKDAYS: tuple[str, ...] = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")


_WEEKDAY_INDEX = {code: index for index, code in enumerate(WEEKDAYS)}


@dataclass(frozen=True)
class Occurrence:
    """One appearance of an event in a window.

    Frozen, and holding the row rather than copying its fields: an occurrence
    is a *view* of an event at a moment, and a dataclass that duplicated the
    event's columns would be a second place for the two to disagree about the
    title.
    """

    event: CalendarEvent
    starts_at: datetime
    ends_at: datetime

    @property
    def id(self) -> str:
        return f"{self.event.id}:{self.starts_at.isoformat()}"


def _moment(raw: Any, name: str) -> datetime:
    from src.core.clock import parse

    value = parse(str(raw or "")) if raw else None
    if value is None:
        raise ValidationError(f"`{name}` must be an ISO date or timestamp.")
    return value


def _involves(row: CalendarEvent, user_id: UUID) -> bool:
    """Whether this reader organises the event or was invited to it."""
    if row.organizer_id == user_id:
        return True
    return any(
        str(entry.get("user_id")) == str(user_id)
        for entry in (row.participants or [])
        if isinstance(entry, dict)
    )


def _expand(row: CalendarEvent, start: datetime, end: datetime) -> list[Occurrence]:
    """Every occurrence of one event inside the window.

    A single event contributes at most one; a series contributes its starts
    stepped by the rule. The event's own duration is carried forward rather
    than recomputed, so a 90-minute meeting stays 90 minutes on every
    occurrence — including across a daylight-saving change, where recomputing
    an end time from a wall clock would silently shorten one of them.
    """
    duration = (row.ends_at - row.starts_at) if row.ends_at and row.starts_at else timedelta(0)
    rule = row.recurrence if isinstance(row.recurrence, dict) else None

    if not rule:
        overlaps = row.starts_at < end and (row.starts_at + duration) > start
        return [Occurrence(row, row.starts_at, row.starts_at + duration)] if overlaps else []

    frequency = str(rule.get("freq") or "").upper()
    if frequency not in EVENT_FREQUENCY:
        # A rule this module cannot read is treated as no rule at all: showing
        # the first occurrence is wrong in a small way, and showing nothing is
        # wrong in the way that loses somebody's meeting.
        return _expand_single(row, duration, start, end)

    interval = max(int(rule.get("interval") or 1), 1)
    days = _weekdays(rule.get("byday"))
    stop = min(end, row.recurrence_until + duration) if row.recurrence_until else end

    found: list[Occurrence] = []
    for moment in _series(row.starts_at, frequency, interval, days, stop):
        if len(found) >= MAX_OCCURRENCES:
            break
        if moment >= stop:
            break
        if moment < end and (moment + duration) > start:
            found.append(Occurrence(row, moment, moment + duration))
    return found


def _expand_single(
    row: CalendarEvent, duration: timedelta, start: datetime, end: datetime
) -> list[Occurrence]:
    overlaps = row.starts_at < end and (row.starts_at + duration) > start
    return [Occurrence(row, row.starts_at, row.starts_at + duration)] if overlaps else []


def _weekdays(raw: Any) -> tuple[int, ...]:
    """`["MO","WE"]` → the weekday numbers `date.weekday()` uses."""
    if not isinstance(raw, (list, tuple)):
        return ()
    return tuple(
        sorted(
            {
                _WEEKDAY_INDEX[str(code).upper()]
                for code in raw
                if str(code).upper() in _WEEKDAY_INDEX
            }
        )
    )


def _series(
    first: datetime, frequency: str, interval: int, days: tuple[int, ...], stop: datetime
):
    """The start times of a series, in order, up to `stop`.

    A generator, because the caller stops as soon as the window is behind it —
    a weekly series that began in 2019 must not build six years of datetimes to
    answer a question about next week.

    `WEEKLY` with `byday` steps week by week and yields the named days inside
    each; `MONTHLY` keeps the day of the month and skips months too short for
    it, which is the reading that never silently moves the 31st to the 1st.
    """
    if frequency == "DAILY":
        step = timedelta(days=interval)
        moment = first
        while moment < stop:
            yield moment
            moment += step
        return

    if frequency == "WEEKLY":
        wanted = days or (first.weekday(),)
        # The Monday of the first occurrence's week, so the named days can be
        # walked in order within each step.
        week = (first - timedelta(days=first.weekday())).replace(
            hour=first.hour, minute=first.minute, second=first.second, microsecond=0
        )
        while week < stop:
            for weekday in wanted:
                moment = week + timedelta(days=weekday)
                if moment >= first:
                    yield moment
            week += timedelta(weeks=interval)
        return

    # MONTHLY, on the same day of the month.
    year, month, day = first.year, first.month, first.day
    while True:
        length = calendar_module.monthrange(year, month)[1]
        if day <= length:
            moment = first.replace(year=year, month=month, day=day)
            if moment >= stop:
                return
            if moment >= first:
                yield moment
        month += interval
        while month > 12:
            month -= 12
            year += 1
        if year > stop.year + 1:
            return


def _response_of(row: CalendarEvent, user_id: UUID) -> str | None:
    for entry in row.participants or []:
        if isinstance(entry, dict) and str(entry.get("user_id")) == str(user_id):
            return str(entry.get("response") or "NEEDS_ACTION")
    return None
