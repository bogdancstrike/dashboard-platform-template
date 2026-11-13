"""Task templates: list, create, change."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.services.records import writes as record_writes
from src.services.work.sprints import MANAGE, READ, _points

FREQUENCIES = ("DAILY", "WEEKLY", "MONTHLY", "CUSTOM")


UNITS = ("DAY", "WEEK")


WEEKDAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


#: A run makes at most this many occurrences per rule — a rule left untouched
#: for a year must not flood the board with a year of copies in one go.
MAX_CATCH_UP = 3


JOBS = {
    "work.recurring-tasks": ("Recurring tasks", "0 * * * *", "RECURRENCE", timedelta(hours=1)),
    "work.sprint-snapshots": ("Sprint burndown snapshots", "5 0 * * *", "SNAPSHOT", timedelta(hours=6)),
}


def _template(session, template_id: Any):
    from src.models.planning import TaskTemplate

    identifier = parse_uuid(template_id, field="template_id")
    row = session.scalars(
        select(TaskTemplate).where(TaskTemplate.id == identifier, TaskTemplate.deleted_at.is_(None))
    ).first()
    if row is None:
        raise NotFoundError("No template with that id.", details={"template_id": str(template_id)})
    return row


def _checklist(raw: Any) -> list[dict[str, Any]]:
    if raw in (None, ""):
        return []
    if not isinstance(raw, list):
        raise ValidationError("A checklist is a list of steps.", details={"checklist": raw})
    items = []
    for item in raw[: record_writes.MAX_ITEMS]:
        text = item.get("text") if isinstance(item, dict) else item
        text = str(text or "").strip()[: record_writes.MAX_ITEM_CHARS]
        if text:
            items.append({"text": text, "done": False})
    return items


def serialize_template(row) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "name": row.name,
        "title": row.title,
        "description": row.description,
        "kind": row.kind,
        "priority": row.priority,
        "estimate_hours": float(row.estimate_hours) if row.estimate_hours is not None else None,
        "story_points": _points(row.story_points) if row.story_points is not None else None,
        "checklist": row.checklist or [],
        "labels": list(row.labels or []),
        "cover_color": row.cover_color,
        "due_in_days": row.due_in_days,
        "usage_count": row.usage_count,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def templates(session, args: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.planning import TaskTemplate

    principal.require(READ)
    statement = select(TaskTemplate).where(TaskTemplate.deleted_at.is_(None))
    term = (args.get("q") or "").strip()
    if term:
        statement = statement.where(TaskTemplate.name.ilike(f"%{term}%") | TaskTemplate.title.ilike(f"%{term}%"))
    rows = session.scalars(statement.order_by(TaskTemplate.usage_count.desc(), TaskTemplate.name)).all()
    return {
        "items": [serialize_template(row) for row in rows],
        "can_manage": principal.can(MANAGE),
    }


def _apply_fields(row, body: dict[str, Any], *, creating: bool) -> None:
    from src.core import vocabulary

    if creating or "name" in body:
        name = str(body.get("name") or "").strip()
        if not name:
            raise ValidationError("A template needs a name.", details={"field": "name"})
        row.name = name[:120]
    if creating or "title" in body:
        title = str(body.get("title") or body.get("name") or "").strip()
        if not title:
            raise ValidationError("A template needs the title its tasks get.", details={"field": "title"})
        row.title = title[:240]
    if "description" in body:
        row.description = body.get("description") or None
    if "kind" in body or creating:
        kind = str(body.get("kind") or "TASK").upper()
        if kind not in vocabulary.TASK_KIND:
            raise ValidationError(f"{kind} is not a kind of task.", details={"field": "kind"})
        row.kind = kind
    if "priority" in body or creating:
        priority = str(body.get("priority") or "NORMAL").upper()
        if priority not in vocabulary.PRIORITY:
            raise ValidationError(f"{priority} is not a priority.", details={"field": "priority"})
        row.priority = priority
    for name, top in (("estimate_hours", 10_000), ("story_points", 999)):
        if name in body:
            raw = body.get(name)
            if raw in (None, ""):
                setattr(row, name, None)
                continue
            try:
                value = Decimal(str(raw))
            except Exception as exc:  # noqa: BLE001
                raise ValidationError(f"{name.replace('_', ' ')} must be a number.", details={"field": name}) from exc
            if value < 0 or value > top:
                raise ValidationError(f"{name.replace('_', ' ')} is out of range.", details={"field": name})
            setattr(row, name, value)
    if "checklist" in body:
        row.checklist = _checklist(body.get("checklist")) or None
    if "labels" in body:
        labels = body.get("labels") or []
        if not isinstance(labels, list):
            raise ValidationError("Labels are a list.", details={"field": "labels"})
        row.labels = [str(item)[:48] for item in labels][:12] or None
    if "cover_color" in body:
        row.cover_color = (str(body.get("cover_color") or "")[:16]) or None
    if "due_in_days" in body:
        raw = body.get("due_in_days")
        if raw in (None, ""):
            row.due_in_days = None
        else:
            try:
                days = int(raw)
            except (TypeError, ValueError) as exc:
                raise ValidationError("Due in is a number of days.", details={"field": "due_in_days"}) from exc
            if days < 0 or days > 3650:
                raise ValidationError("Due in is between 0 and 3650 days.", details={"field": "due_in_days"})
            row.due_in_days = days


def create_template(session, payload: Any, *, principal) -> dict[str, Any]:
    from src.models.planning import TaskTemplate

    principal.require(MANAGE)
    body = payload if isinstance(payload, dict) else {}
    row = TaskTemplate(owner_id=principal.user_id, usage_count=0)
    _apply_fields(row, body, creating=True)
    session.add(row)
    session.flush()
    _audit_template(session, row, "CREATE", principal, f"created the task template {row.name}")
    return serialize_template(row)


def update_template(session, template_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    row = _template(session, template_id)
    _apply_fields(row, payload if isinstance(payload, dict) else {}, creating=False)
    session.flush()
    _audit_template(session, row, "UPDATE", principal, f"changed the task template {row.name}")
    return serialize_template(row)


def _audit_template(session, row, action, principal, message) -> None:
    audit.record(
        session, action=action, resource_type="task_template", resource_id=row.id,
        resource_label=row.name, principal=principal, after={"name": row.name},
        message=message, activity=False,
    )
