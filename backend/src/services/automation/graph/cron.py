"""The five-field cron expressions scheduled triggers use."""

from __future__ import annotations

from datetime import datetime, timedelta

from src.core.errors import ValidationError


def _cron(value: str) -> str:

    text = _schedule_fields(value)
    for part, (low, high) in zip(text.split(" "), _CRON_RANGES):
        _cron_values(part, low, high)
    return text


_CRON_RANGES = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 7))


def _cron_values(part: str, low: int, high: int) -> set[int]:
    values: set[int] = set()
    for piece in part.split(","):
        step = 1
        if "/" in piece:
            piece, raw_step = piece.split("/", 1)
            step = _cron_int(raw_step, 1, high or 1)
        if piece in ("*", ""):
            start, end = low, high
        elif "-" in piece:
            first, last = piece.split("-", 1)
            start, end = _cron_int(first, low, high), _cron_int(last, low, high)
        else:
            start = end = _cron_int(piece, low, high)
            if step != 1:
                end = high
        if start > end:
            raise ValidationError(f"{part!r} runs backwards in the schedule.")
        values.update(range(start, end + 1, step))
    return values


def _cron_int(raw: str, low: int, high: int) -> int:
    try:
        number = int(raw)
    except ValueError as error:
        raise ValidationError(f"{raw!r} is not a number in the schedule.") from error
    if not low <= number <= high:
        raise ValidationError(f"{number} is outside {low}–{high} in the schedule.")
    return number


def cron_matches(expression: str, moment: datetime) -> bool:
    minute, hour, day, month, weekday = expression.split(" ")
    weekdays = {value % 7 for value in _cron_values(weekday, 0, 7)}
    day_ok = moment.day in _cron_values(day, 1, 31)
    weekday_ok = (moment.isoweekday() % 7) in weekdays
    # Cron's own rule: when both day fields are restricted, either may match.
    if day != "*" and weekday != "*":
        calendar_ok = day_ok or weekday_ok
    else:
        calendar_ok = day_ok and weekday_ok
    return (
        moment.minute in _cron_values(minute, 0, 59)
        and moment.hour in _cron_values(hour, 0, 23)
        and moment.month in _cron_values(month, 1, 12)
        and calendar_ok
    )


def cron_due(expression: str, since: datetime | None, until: datetime) -> bool:
    """Whether the schedule fired in (since, until] — looking back a day at most."""
    end = until.replace(second=0, microsecond=0)
    start = max(since or end - timedelta(minutes=1), end - timedelta(days=1))
    moment = start.replace(second=0, microsecond=0) + timedelta(minutes=1)
    while moment <= end:
        if cron_matches(expression, moment):
            return True
        moment += timedelta(minutes=1)
    return False


def _schedule_fields(value: str) -> str:
    """A five-field cron expression, stored rather than interpreted.

    Nothing runs it yet — scheduling is §23 — and storing it now is what lets
    the page say when a rule is *meant* to run without pretending it does.
    Validated to five fields so the day a scheduler reads this column it is not
    reading somebody's prose.
    """
    text = " ".join(value.split())
    if not text:
        return "*/15 * * * *"
    if len(text.split(" ")) != 5:
        raise ValidationError(
            "A schedule is five cron fields — minute, hour, day, month, weekday.",
            details={"schedule": text},
        )
    return text[:32]
