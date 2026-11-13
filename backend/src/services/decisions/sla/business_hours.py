"""Business calendars: open hours and business-minute arithmetic."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from src.models.sla import BusinessCalendar

MANAGE = "sla.manage"


DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


ACTIONS = ("NOTIFY", "ASSIGN", "RAISE_PRIORITY")


NOTIFY_TARGETS = ("assignee", "manager", "user")


CONDITION_KEYS = ("customer_ids", "segments", "categories", "channels")


CLOSED = ("RESOLVED", "CLOSED")


#: How far ahead a deadline is searched for before giving up.
MAX_DAYS = 800


def _zone(calendar: BusinessCalendar | None) -> ZoneInfo:
    try:
        return ZoneInfo(calendar.timezone if calendar else "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _parse_hm(value: str) -> time:
    hours, minutes = str(value).split(":")
    return time(int(hours) % 24, int(minutes))


def _spans(calendar: BusinessCalendar, day: date, zone: ZoneInfo) -> list[tuple[datetime, datetime]]:
    """The working spans of one local day, as aware datetimes."""
    holidays = {str(item.get("date")) for item in (calendar.holidays or []) if isinstance(item, dict)}
    if day.isoformat() in holidays:
        return []
    spans = []
    for pair in (calendar.hours or {}).get(DAYS[day.weekday()], []) or []:
        start, end = _parse_hm(pair[0]), _parse_hm(pair[1])
        begin = datetime.combine(day, start, zone)
        finish = datetime.combine(day, end, zone) if end > start else datetime.combine(
            day + timedelta(days=1), time(0, 0), zone)
        spans.append((begin, finish))
    return sorted(spans)


def add_business_minutes(calendar: BusinessCalendar | None, start: datetime, minutes: int) -> datetime:
    """The moment `minutes` of working time after `start`."""
    if calendar is None:
        return start + timedelta(minutes=minutes)
    zone = _zone(calendar)
    local = start.astimezone(zone)
    remaining = timedelta(minutes=max(0, minutes))
    day = local.date()
    for _ in range(MAX_DAYS):
        for begin, finish in _spans(calendar, day, zone):
            if finish <= local:
                continue
            begin = max(begin, local)
            available = finish - begin
            if remaining <= available:
                return begin + remaining
            remaining -= available
        day += timedelta(days=1)
    return start + timedelta(minutes=minutes)  # a calendar with no working hours at all


def business_minutes_between(calendar: BusinessCalendar | None, start: datetime, end: datetime) -> int:
    """Working minutes from `start` to `end`; negative when `end` is earlier."""
    if end < start:
        return -business_minutes_between(calendar, end, start)
    if calendar is None:
        return int((end - start).total_seconds() // 60)
    zone = _zone(calendar)
    local_start, local_end = start.astimezone(zone), end.astimezone(zone)
    total = timedelta()
    day = local_start.date()
    for _ in range(MAX_DAYS):
        if day > local_end.date():
            break
        for begin, finish in _spans(calendar, day, zone):
            overlap = min(finish, local_end) - max(begin, local_start)
            if overlap > timedelta():
                total += overlap
        day += timedelta(days=1)
    return int(total.total_seconds() // 60)


def is_open_now(calendar: BusinessCalendar | None, moment: datetime) -> bool:
    if calendar is None:
        return True
    zone = _zone(calendar)
    local = moment.astimezone(zone)
    return any(begin <= local < finish for begin, finish in _spans(calendar, local.date(), zone))
