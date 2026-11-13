"""A policy's and a calendar's payloads, checked."""

from __future__ import annotations

from datetime import date
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from src.core import vocabulary
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.models.sla import BusinessCalendar, SlaPolicy
from src.services.decisions.sla.business_hours import (
    ACTIONS,
    CLOSED,
    CONDITION_KEYS,
    DAYS,
    NOTIFY_TARGETS,
    _parse_hm,
)


def _minutes(value: Any, *, field: str) -> int | None:
    if value in (None, ""):
        return None
    try:
        minutes = int(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{field} must be a number of minutes.", details={"field": field}) from exc
    if minutes <= 0 or minutes > 60 * 24 * 365:
        raise ValidationError(f"{field} must be a positive number of minutes.", details={"field": field})
    return minutes


def _checked_policy(session, payload: dict[str, Any], row: SlaPolicy) -> None:
    name = str(payload.get("name", row.name or "")).strip()
    if not name:
        raise ValidationError("Give the policy a name.", details={"field": "name"})
    row.name = name[:160]
    row.description = str(payload.get("description", row.description or "")).strip() or None
    row.active = bool(payload.get("active", True if row.active is None else row.active))
    row.conditions = _conditions(payload.get("conditions", row.conditions or {}) or {})
    row.targets = _targets(payload.get("targets", row.targets or {}) or {})
    calendar = _calendar_choice(
        session, payload.get("calendar_id", str(row.calendar_id) if row.calendar_id else None)
    )
    row.calendar_id = calendar.id if calendar is not None else None
    row.calendar = calendar
    row.pause_statuses = _pauses(payload.get("pause_statuses", row.pause_statuses or []) or [])
    steps = [_step(index, step) for index, step in
             enumerate(payload.get("escalations", row.escalations or []) or [])]
    row.escalations = sorted(steps, key=lambda item: item["at_percent"])


_CONDITION_VALUES = {"segments": vocabulary.CUSTOMER_SEGMENT,
                     "categories": vocabulary.TICKET_CATEGORY,
                     "channels": vocabulary.TICKET_CHANNEL}


def _conditions(raw: Any) -> dict[str, list[str]]:
    if not isinstance(raw, dict):
        raise ValidationError("conditions must be an object.", details={"field": "conditions"})
    conditions: dict[str, list[str]] = {}
    for key, values in raw.items():
        if key not in CONDITION_KEYS:
            raise ValidationError(f"{key!r} is not a condition.", details={"field": "conditions"})
        values = [str(item) for item in (values or [])]
        allowed = _CONDITION_VALUES.get(key)
        if allowed is not None and any(item not in allowed for item in values):
            raise ValidationError(f"Unknown value in {key}.", details={"field": f"conditions.{key}"})
        if key == "customer_ids":
            values = [str(parse_uuid(item, field="customer_ids")) for item in values]
        if values:
            conditions[key] = values
    return conditions


def _targets(raw: dict[str, Any]) -> dict[str, dict[str, int]]:
    targets: dict[str, dict[str, int]] = {}
    for priority, pair in raw.items():
        if priority not in vocabulary.PRIORITY:
            raise ValidationError(f"{priority!r} is not a priority.", details={"field": "targets"})
        first = _minutes((pair or {}).get("first_response"), field=f"targets.{priority}.first_response")
        resolution = _minutes((pair or {}).get("resolution"), field=f"targets.{priority}.resolution")
        if first and resolution and first > resolution:
            raise ValidationError(f"{priority.title()}: the first response cannot be due after resolution.",
                                  details={"field": f"targets.{priority}"})
        entry = {key: value for key, value in (("first_response", first), ("resolution", resolution)) if value}
        if entry:
            targets[priority] = entry
    return targets


def _calendar_choice(session, calendar_id: Any) -> BusinessCalendar | None:
    if not calendar_id:
        return None
    calendar = session.get(BusinessCalendar, parse_uuid(calendar_id, field="calendar_id"))
    if calendar is None or calendar.deleted_at is not None:
        raise ValidationError("That calendar does not exist.", details={"field": "calendar_id"})
    return calendar


def _pauses(raw: Any) -> list[str]:
    pauses = [str(item) for item in raw]
    if any(item not in vocabulary.TICKET_STATUS or item in CLOSED for item in pauses):
        raise ValidationError("Pause only on open ticket statuses.", details={"field": "pause_statuses"})
    return pauses


def _step(index: int, step: Any) -> dict[str, Any]:
    step = step or {}

    def refuse(message: str) -> ValidationError:
        return ValidationError(f"Step {index + 1}: {message}", details={"field": "escalations"})

    action = str(step.get("action") or "").upper()
    if action not in ACTIONS:
        raise refuse("unknown action.")
    try:
        at = int(step.get("at_percent"))
    except (TypeError, ValueError) as exc:
        raise refuse("give a percentage.") from exc
    if at < 1 or at > 500:
        raise refuse("between 1% and 500%.")
    clean: dict[str, Any] = {"at_percent": at, "action": action}
    if action in ("NOTIFY", "ASSIGN"):
        target = str(step.get("target") or "assignee")
        if target not in NOTIFY_TARGETS:
            raise refuse("unknown target.")
        clean["target"] = target
        if target == "user":
            clean["user_id"] = str(parse_uuid(step.get("user_id"), field="user_id"))
    return clean


def _checked_calendar(payload: dict[str, Any], row: BusinessCalendar) -> None:
    name = str(payload.get("name", row.name or "")).strip()
    if not name:
        raise ValidationError("Give the calendar a name.", details={"field": "name"})
    row.name = name[:120]
    zone = str(payload.get("timezone", row.timezone or "UTC"))
    try:
        ZoneInfo(zone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValidationError(f"{zone!r} is not a time zone.", details={"field": "timezone"}) from exc
    row.timezone = zone
    hours_in = payload.get("hours", row.hours or {}) or {}
    hours: dict[str, list[list[str]]] = {}
    for day in DAYS:
        spans = []
        for pair in hours_in.get(day, []) or []:
            try:
                start, end = _parse_hm(pair[0]), _parse_hm(pair[1])
            except (TypeError, ValueError, IndexError) as exc:
                raise ValidationError(f"{day}: times look like 09:00.", details={"field": f"hours.{day}"}) from exc
            if end <= start and not (end.hour == 0 and end.minute == 0):
                raise ValidationError(f"{day}: a span must end after it starts.", details={"field": f"hours.{day}"})
            spans.append([start.strftime("%H:%M"), end.strftime("%H:%M")])
        hours[day] = sorted(spans)
    if not any(hours.values()):
        raise ValidationError("A calendar needs at least one working span.", details={"field": "hours"})
    row.hours = hours
    holidays = []
    for item in payload.get("holidays", row.holidays or []) or []:
        try:
            day = date.fromisoformat(str((item or {}).get("date")))
        except (TypeError, ValueError) as exc:
            raise ValidationError("Holidays need a date (YYYY-MM-DD).", details={"field": "holidays"}) from exc
        holidays.append({"date": day.isoformat(), "name": str((item or {}).get("name") or "Holiday")[:80]})
    row.holidays = sorted(holidays, key=lambda item: item["date"])
    if "is_default" in payload:
        row.is_default = bool(payload.get("is_default"))
