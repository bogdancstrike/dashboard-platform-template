"""An event's payload, checked."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from src.core.cleaners import choice, flag, optional_uuid, text, unknown_named
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.core.validation import Field, Schema
from src.core.vocabulary import (
    EVENT_CATEGORY,
    EVENT_FREQUENCY,
    EVENT_RESPONSE,
    EVENT_STATUS,
)
from src.services.work.calendar.recurrence import _WEEKDAY_INDEX, WEEKDAYS


def _times(out: dict[str, Any], ctx) -> None:
    starts = _optional_moment(ctx.payload.get("starts_at"), "starts_at")
    ends = _optional_moment(ctx.payload.get("ends_at"), "ends_at")
    if not ctx.partial and (starts is None or ends is None):
        raise ValidationError("An event needs a start and an end.")
    if starts is not None:
        out["starts_at"] = starts
    if ends is not None:
        out["ends_at"] = ends
    if starts is not None and ends is not None and ends <= starts:
        raise ValidationError("An event has to end after it starts.")


def _recurrence(out: dict[str, Any], ctx) -> None:
    if not ctx.sent("recurrence"):
        return
    out["recurrence"] = _validated_recurrence(ctx.payload.get("recurrence"))
    if out["recurrence"] is None:
        # A series that stops recurring has no horizon either; leaving the
        # old one would keep the event in a range scan it can never match.
        out["recurrence_until"] = None


def _reminder(raw: Any, ctx) -> int | None:
    if raw is None or raw == "":
        return None
    minutes = _whole(raw, "reminder_minutes")
    if not 0 <= minutes <= 60 * 24 * 14:
        raise ValidationError("A reminder runs from 0 minutes to 14 days before.")
    return minutes


_SCHEMA = Schema([
    Field("title", text(240, required="An event needs a title.")),
    Field("description", text(4000, empty=None), sparse=True),
    Field("location", text(200, empty=None), sparse=True),
    Field("category", choice(EVENT_CATEGORY, default="MEETING", error=unknown_named("category"))),
    Field("status", choice(EVENT_STATUS, default="CONFIRMED", error=unknown_named("status")),
          sparse=True),
    Field("all_day", flag, sparse=True),
    _times,
    Field("participants", lambda raw, ctx: _validated_participants(raw), sparse=True),
    _recurrence,
    Field("recurrence_until", lambda raw, ctx: _optional_moment(raw, "recurrence_until"),
          sparse=True),
    Field("reminder_minutes", _reminder, sparse=True),
    Field("project_id", optional_uuid("project_id"), sparse=True),
    Field("task_id", optional_uuid("task_id"), sparse=True),
    Field("color", lambda raw, ctx: str(raw or "")[:16] or "#5b5bd6", sparse=True),
])


def _validated(payload: dict[str, Any] | None, *, partial: bool) -> dict[str, Any]:
    return _SCHEMA.validate(payload, partial=partial)


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
