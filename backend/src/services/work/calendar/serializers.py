"""Events and occurrences as the API returns them, and how a series is described."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from src.core.clock import iso
from src.core.naming import initials
from src.core.vocabulary import EVENT_FREQUENCY
from src.models.business import CalendarEvent
from src.services.work.calendar.recurrence import (
    MANAGE,
    Occurrence,
    _involves,
    _response_of,
)


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
