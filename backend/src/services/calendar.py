"""The calendar (§19): a window of time, and what is in it.

Four decisions shape this module.

**A window is the query, and recurrence expands here.** The browser asks for
`from`/`to` and gets *occurrences*, not rows. Expanding a series in the browser
would mean a second implementation of the recurrence rule, and the two would
disagree about the last Friday of a month long before anybody noticed. The
model materialises `recurrence_until` for exactly this reason: a series that
cannot reach the window is excluded by a range scan rather than expanded and
thrown away.

**An occurrence is derived and says so.** Its id is `<event id>:<start>`, which
is stable enough to key a grid on and obviously not a primary key. Editing an
occurrence edits the *series*, and the API says which — per-occurrence
exceptions are a second table, a second set of rules about who may change what,
and a question nobody has asked yet.

**"Who is coming" is a fact about a person, and only they may state it.** The
participants list carries each invitee's own response, and `respond()` will only
write the caller's own entry. An organiser who could accept on somebody's behalf
turns an attendance list into a guess.

**A clash is computed, never stored.** Two events overlapping is a fact about a
*reader* — the same pair is a clash for the two people in both and irrelevant to
everybody else — so it is worked out over the window that was asked for, for the
person who asked.
"""

from __future__ import annotations

import calendar as calendar_module
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import ForbiddenError, NotFoundError, ValidationError
from src.core.naming import initials
from src.core.pagination import parse_uuid
from src.core.vocabulary import (
    EVENT_CATEGORY,
    EVENT_FREQUENCY,
    EVENT_RESPONSE,
    EVENT_STATUS,
)
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


# ── Reading a window ─────────────────────────────────────────────────────


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


def _response_of(row: CalendarEvent, user_id: UUID) -> str | None:
    for entry in row.participants or []:
        if isinstance(entry, dict) and str(entry.get("user_id")) == str(user_id):
            return str(entry.get("response") or "NEEDS_ACTION")
    return None


# ── One event ────────────────────────────────────────────────────────────


def get(session, event_id: Any, *, principal) -> dict[str, Any]:
    principal.require(VIEW)
    row = _event(session, event_id)
    return _serialize(row, principal)


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    values = _validated(payload, partial=False)
    row = CalendarEvent(organizer_id=getattr(principal, "user_id", None), **values)
    # The organiser is a participant, and accepted: somebody who called the
    # meeting has plainly said they are coming, and an organiser sitting in
    # their own attendee list as "no answer" is a list nobody trusts.
    row.participants = _with_organiser(row.participants, principal)
    session.add(row)
    session.flush()
    audit.record(
        session,
        action="calendar.create",
        resource_type="calendar_event",
        resource_id=row.id,
        resource_label=row.title,
        principal=principal,
        after=_audit_state(row),
    )
    return _serialize(row, principal)


def update(session, event_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Change an event — and, for a series, every occurrence of it.

    Stated rather than implied: an editor that silently changed only the
    occurrence somebody clicked, or silently changed all of them, is an editor
    that loses an afternoon either way. The single-occurrence exception is a
    second table and a question nobody has asked yet (see the module docstring).
    """
    principal.require(MANAGE)
    row = _event(session, event_id)
    _require_organiser(row, principal)
    before = _audit_state(row)
    for name, value in _validated(payload, partial=True).items():
        setattr(row, name, value)
    session.flush()
    audit.record(
        session,
        action="calendar.update",
        resource_type="calendar_event",
        resource_id=row.id,
        resource_label=row.title,
        principal=principal,
        before=before,
        after=_audit_state(row),
    )
    return _serialize(row, principal)


def remove(session, event_id: Any, *, principal) -> dict[str, Any]:
    """Cancel an event.

    A soft delete *and* a cancelled status, because the two answer different
    questions: the row stays for the audit trail, and anything still reading
    the event — a project page, a report — sees that it is not happening.
    """
    principal.require(MANAGE)
    row = _event(session, event_id)
    _require_organiser(row, principal)
    row.status = "CANCELLED"
    row.deleted_at = now()
    session.flush()
    audit.record(
        session,
        action="calendar.delete",
        resource_type="calendar_event",
        resource_id=row.id,
        resource_label=row.title,
        principal=principal,
        before=_audit_state(row),
    )
    return {"deleted": True, "id": str(row.id)}


def respond(session, event_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Say whether *you* are coming.

    Needs `calendar.view` and not `calendar.manage`: answering an invitation is
    not editing a calendar. And it writes only the caller's own entry — an
    organiser accepting on somebody's behalf turns an attendance list into a
    guess, which is worse than an empty one.
    """
    principal.require(VIEW)
    row = _event(session, event_id)
    me = getattr(principal, "user_id", None)
    if me is None:
        raise ForbiddenError("Only a signed-in person can answer an invitation.")

    answer = str((payload or {}).get("response") or "").strip().upper()
    if answer not in EVENT_RESPONSE:
        raise ValidationError(
            "Unknown response.",
            details={"response": answer, "allowed": list(EVENT_RESPONSE)},
        )

    entries = [dict(entry) for entry in (row.participants or []) if isinstance(entry, dict)]
    for entry in entries:
        if str(entry.get("user_id")) == str(me):
            entry["response"] = answer
            break
    else:
        raise ForbiddenError("You were not invited to this event.")

    # Reassigned rather than mutated: a JSONB column changed in place is not
    # seen as dirty by SQLAlchemy and the UPDATE never happens.
    row.participants = entries
    session.flush()
    audit.record(
        session,
        action="calendar.respond",
        resource_type="calendar_event",
        resource_id=row.id,
        resource_label=row.title,
        principal=principal,
        metadata={"response": answer},
        message=f"answered {answer.lower().replace('_', ' ')}",
    )
    return _serialize(row, principal)


# ── Validation ───────────────────────────────────────────────────────────


def _validated(payload: dict[str, Any] | None, *, partial: bool) -> dict[str, Any]:
    data = payload if isinstance(payload, dict) else {}
    values: dict[str, Any] = {}

    if "title" in data or not partial:
        title = str(data.get("title") or "").strip()
        if not title:
            raise ValidationError("An event needs a title.")
        values["title"] = title[:240]

    if "description" in data:
        values["description"] = str(data.get("description") or "").strip()[:4000] or None
    if "location" in data:
        values["location"] = str(data.get("location") or "").strip()[:200] or None

    if "category" in data or not partial:
        category = str(data.get("category") or "MEETING").upper()
        if category not in EVENT_CATEGORY:
            raise ValidationError(
                "Unknown category.",
                details={"category": category, "allowed": list(EVENT_CATEGORY)},
            )
        values["category"] = category

    if "status" in data:
        status = str(data.get("status") or "CONFIRMED").upper()
        if status not in EVENT_STATUS:
            raise ValidationError(
                "Unknown status.", details={"status": status, "allowed": list(EVENT_STATUS)}
            )
        values["status"] = status

    if "all_day" in data:
        values["all_day"] = bool(data.get("all_day"))

    starts = _optional_moment(data.get("starts_at"), "starts_at")
    ends = _optional_moment(data.get("ends_at"), "ends_at")
    if not partial and (starts is None or ends is None):
        raise ValidationError("An event needs a start and an end.")
    if starts is not None:
        values["starts_at"] = starts
    if ends is not None:
        values["ends_at"] = ends
    if starts is not None and ends is not None and ends <= starts:
        raise ValidationError("An event has to end after it starts.")

    if "participants" in data:
        values["participants"] = _validated_participants(data.get("participants"))

    if "recurrence" in data:
        values["recurrence"] = _validated_recurrence(data.get("recurrence"))
        if values["recurrence"] is None:
            # A series that stops recurring has no horizon either; leaving the
            # old one would keep the event in a range scan it can never match.
            values["recurrence_until"] = None

    if "recurrence_until" in data:
        values["recurrence_until"] = _optional_moment(
            data.get("recurrence_until"), "recurrence_until"
        )

    if "reminder_minutes" in data:
        raw = data.get("reminder_minutes")
        if raw is None or raw == "":
            values["reminder_minutes"] = None
        else:
            minutes = _whole(raw, "reminder_minutes")
            if not 0 <= minutes <= 60 * 24 * 14:
                raise ValidationError("A reminder runs from 0 minutes to 14 days before.")
            values["reminder_minutes"] = minutes

    if "project_id" in data:
        values["project_id"] = (
            parse_uuid(data["project_id"], field="project_id") if data["project_id"] else None
        )
    if "task_id" in data:
        values["task_id"] = (
            parse_uuid(data["task_id"], field="task_id") if data["task_id"] else None
        )
    if "color" in data:
        values["color"] = str(data.get("color") or "")[:16] or "#5b5bd6"

    return values


def _validated_participants(raw: Any) -> list[dict[str, Any]] | None:
    """The attendee list, with each entry's own response preserved.

    A response defaults to `NEEDS_ACTION` and is never invented as "accepted":
    the point of the column is to distinguish somebody who agreed to come from
    somebody who has not looked yet.
    """
    if raw in (None, []):
        return None
    if not isinstance(raw, list):
        raise ValidationError("participants must be a list")
    if len(raw) > 200:
        raise ValidationError("An event takes at most 200 participants.")

    entries: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        if isinstance(item, str):
            item = {"user_id": item}
        if not isinstance(item, dict) or not item.get("user_id"):
            raise ValidationError("each participant needs a user_id")
        user_id = str(parse_uuid(item["user_id"], field="participants"))
        if user_id in seen:
            continue
        seen.add(user_id)
        response = str(item.get("response") or "NEEDS_ACTION").upper()
        entries.append(
            {
                "user_id": user_id,
                "name": str(item.get("name") or "")[:160] or None,
                "email": str(item.get("email") or "")[:255] or None,
                "response": response if response in EVENT_RESPONSE else "NEEDS_ACTION",
            }
        )
    return entries or None


def _validated_recurrence(raw: Any) -> dict[str, Any] | None:
    """An RRULE-shaped document the expander can actually read.

    Validated on write rather than tolerated on read, because a rule the
    expander does not understand produces a series *nobody ever sees* — the
    quietest possible failure, and the reason `_expand` falls back to a single
    occurrence rather than to nothing.
    """
    if raw in (None, {}, ""):
        return None
    if not isinstance(raw, dict):
        raise ValidationError("recurrence must be an object")

    frequency = str(raw.get("freq") or "").upper()
    if frequency not in EVENT_FREQUENCY:
        raise ValidationError(
            "A repeat is daily, weekly or monthly.",
            details={"freq": frequency, "allowed": list(EVENT_FREQUENCY)},
        )
    interval = _whole(raw.get("interval") or 1, "interval")
    if not 1 <= interval <= 52:
        raise ValidationError("A repeat interval runs from 1 to 52.")

    rule: dict[str, Any] = {"freq": frequency, "interval": interval}
    days = [str(code).upper() for code in (raw.get("byday") or [])]
    unknown = [code for code in days if code not in _WEEKDAY_INDEX]
    if unknown:
        raise ValidationError(
            "Unknown weekday.", details={"byday": unknown, "allowed": list(WEEKDAYS)}
        )
    if days:
        rule["byday"] = sorted(set(days), key=lambda code: _WEEKDAY_INDEX[code])
    return rule


def _optional_moment(raw: Any, name: str) -> datetime | None:
    if raw in (None, ""):
        return None
    from src.core.clock import parse

    value = parse(str(raw))
    if value is None:
        raise ValidationError(f"`{name}` must be an ISO date or timestamp.")
    return value


def _whole(value: Any, name: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as error:
        raise ValidationError(f"{name} must be a whole number") from error


def _event(session, event_id: Any) -> CalendarEvent:
    """One event by id, accepting an occurrence id for the series it belongs to.

    Deliberately tolerant: the grid hands back the id it was given, and making
    every caller remember to split on the colon is a bug waiting for the one
    call site that forgets.
    """
    raw = str(event_id or "").split(":", 1)[0]
    row = session.get(CalendarEvent, parse_uuid(raw, field="event_id"))
    if row is None or row.deleted_at is not None:
        raise NotFoundError("That event does not exist.")
    return row


def _require_organiser(row: CalendarEvent, principal) -> None:
    """Only the organiser changes an event — or an administrator.

    An event sits in other people's weeks, so "anybody who may write to the
    calendar may rewrite yours" is the wrong default. `admin.access` is the
    exception because somebody has to be able to cancel a meeting whose
    organiser has left.
    """
    if row.organizer_id and row.organizer_id != getattr(principal, "user_id", None):
        if not principal.can("admin.access"):
            raise ForbiddenError("Only the organiser of an event can change it.")


def _with_organiser(participants: Any, principal) -> list[dict[str, Any]] | None:
    me = getattr(principal, "user_id", None)
    if me is None:
        return participants
    entries = [dict(entry) for entry in (participants or []) if isinstance(entry, dict)]
    if any(str(entry.get("user_id")) == str(me) for entry in entries):
        return entries or None
    entries.insert(
        0,
        {
            "user_id": str(me),
            "name": getattr(principal, "full_name", None),
            "email": getattr(principal, "email", None),
            "response": "ACCEPTED",
        },
    )
    return entries


# ── Serialisation ────────────────────────────────────────────────────────


def _occurrence(
    item: Occurrence, principal, *, clash: tuple[str, ...] = ()
) -> dict[str, Any]:
    """One occurrence, as a grid draws it."""
    detail = _serialize(item.event, principal)
    me = getattr(principal, "user_id", None)
    detail.update(
        {
            "id": item.id,
            "event_id": str(item.event.id),
            "starts_at": iso(item.starts_at),
            "ends_at": iso(item.ends_at),
            # So a grid can say "every Tuesday" beside the one it is drawing,
            # rather than the reader wondering why editing moves five of them.
            "is_occurrence": item.event.recurrence is not None,
            "day": item.starts_at.date().isoformat(),
            "minutes": int((item.ends_at - item.starts_at).total_seconds() // 60),
            "involves_me": me is not None and _involves(item.event, me),
            "my_response": _response_of(item.event, me) if me is not None else None,
            # Named, not counted: "clashes with the Design review" is
            # actionable and "1 clash" sends somebody hunting for it.
            "clashes_with": list(clash),
        }
    )
    return detail


def _serialize(row: CalendarEvent, principal) -> dict[str, Any]:
    organizer = row.organizer
    me = getattr(principal, "user_id", None)
    return {
        "id": str(row.id),
        "event_id": str(row.id),
        "title": row.title,
        "description": row.description,
        "category": row.category,
        "status": row.status,
        "location": row.location,
        "starts_at": iso(row.starts_at),
        "ends_at": iso(row.ends_at),
        "all_day": bool(row.all_day),
        "organizer": {
            "id": str(row.organizer_id) if row.organizer_id else None,
            "name": organizer.full_name if organizer else None,
        },
        "project_id": str(row.project_id) if row.project_id else None,
        "task_id": str(row.task_id) if row.task_id else None,
        # Initials from `core/naming`, like every other person the platform
        # draws. Computing them in the browser is how "Ada Marie
        # Administrator" came to be `AA` on one screen and `AM` on another.
        "participants": [
            {**entry, "initials": initials(entry.get("name"))}
            for entry in (row.participants or [])
            if isinstance(entry, dict)
        ],
        "recurrence": row.recurrence,
        "recurrence_until": iso(row.recurrence_until),
        "recurrence_text": describe(row.recurrence, row.recurrence_until),
        "reminder_minutes": row.reminder_minutes,
        "color": row.color,
        "involves_me": me is not None and _involves(row, me),
        "my_response": _response_of(row, me) if me is not None else None,
        # The server's answer, so a control is absent or disabled for a reason
        # it knows rather than one the browser guessed (§76).
        "can_edit": _can_edit(row, principal),
    }


def _can_edit(row: CalendarEvent, principal) -> bool:
    if not principal.can(MANAGE):
        return False
    if not row.organizer_id:
        return True
    return row.organizer_id == getattr(principal, "user_id", None) or principal.can(
        "admin.access"
    )


def _audit_state(row: CalendarEvent) -> dict[str, Any]:
    """What an audit entry keeps of an event: the parts somebody argues about.

    The attendee list is reduced to its ids and answers. Keeping the whole
    thing would put a name and an email address into every audit row that
    touched the event, which is a copy of the directory growing in a table
    nobody deletes from.
    """
    return {
        "title": row.title,
        "category": row.category,
        "status": row.status,
        "location": row.location,
        "starts_at": iso(row.starts_at),
        "ends_at": iso(row.ends_at),
        "all_day": bool(row.all_day),
        "recurrence_text": describe(row.recurrence, row.recurrence_until),
        "participants": [
            {"user_id": entry.get("user_id"), "response": entry.get("response")}
            for entry in (row.participants or [])
            if isinstance(entry, dict)
        ],
    }


def describe(rule: Any, until: datetime | None = None) -> str:
    """A repeat, in words — "every Tuesday and Thursday, until 3 June".

    Rendered on the server for the same reason the query inspector's text is
    (§51): the sentence a reader checks against has to come from the same place
    the expansion does, or the two will disagree about what "every third week"
    means and only one of them will be right.
    """
    if not isinstance(rule, dict):
        return ""
    frequency = str(rule.get("freq") or "").upper()
    if frequency not in EVENT_FREQUENCY:
        return ""
    interval = max(int(rule.get("interval") or 1), 1)

    names = {
        "MO": "Monday", "TU": "Tuesday", "WE": "Wednesday", "TH": "Thursday",
        "FR": "Friday", "SA": "Saturday", "SU": "Sunday",
    }
    days = [names[code] for code in (rule.get("byday") or []) if code in names]

    if frequency == "DAILY":
        text = "every day" if interval == 1 else f"every {_ordinal(interval)} day"
    elif frequency == "WEEKLY":
        every = "every week" if interval == 1 else f"every {_ordinal(interval)} week"
        text = f"{every} on {_list(days)}" if days else every
    else:
        text = "every month" if interval == 1 else f"every {_ordinal(interval)} month"

    if until is not None:
        text += f", until {until.date().isoformat()}"
    return text


def _ordinal(number: int) -> str:
    words = {2: "second", 3: "third", 4: "fourth"}
    return words.get(number, f"{number}th")


def _list(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} and {items[-1]}"


def day_bounds(when: date) -> tuple[datetime, datetime]:
    """Midnight to midnight, for callers that want one day.

    Exported because the tests and any future scheduler both want it, and two
    versions of "what counts as a day" is one too many.
    """
    start = datetime.combine(when, time.min, tzinfo=now().tzinfo)
    return start, start + timedelta(days=1)
