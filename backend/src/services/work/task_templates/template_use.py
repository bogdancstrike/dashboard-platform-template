"""Using a template, saving a task as one, removing one."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.services.records import writes as record_writes
from src.services.work.sprints import MANAGE, READ
from src.services.work.task_templates.template_store import (
    _audit_template,
    _template,
    create_template,
    serialize_template,
)
from src.services.work.timeline import _task, as_day, at_midnight


def remove_template(session, template_id: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    row = _template(session, template_id)
    row.deleted_at = now()
    session.flush()
    _audit_template(session, row, "DELETE", principal, f"deleted the task template {row.name}")
    return {"id": str(row.id), "deleted": True}


def template(session, template_id: Any, *, principal) -> dict[str, Any]:
    principal.require(READ)
    return serialize_template(_template(session, template_id))


def use_template(session, template_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    """Create a real task from a template, through the records API's own create."""
    row = _template(session, template_id)
    body = payload if isinstance(payload, dict) else {}
    values: dict[str, Any] = {
        "title": (body.get("title") or row.title),
        "description": row.description,
        "kind": row.kind,
        "priority": row.priority,
        "status": body.get("status") or "NEW",
        "estimate_hours": float(row.estimate_hours) if row.estimate_hours is not None else None,
        "story_points": float(row.story_points) if row.story_points is not None else None,
        "checklist": [{"text": item.get("text", ""), "done": False} for item in (row.checklist or [])] or None,
        "cover_color": row.cover_color,
    }
    for name in ("project_id", "assignee_id", "epic_id", "parent_id"):
        if body.get(name):
            values[name] = body[name]
    start = as_day(body.get("start_date")) or now().date()
    values["start_date"] = at_midnight(start).isoformat()
    if row.due_in_days is not None:
        values["due_date"] = at_midnight(start + timedelta(days=row.due_in_days)).isoformat()
    created = record_writes.create(
        session, "task", {key: value for key, value in values.items() if value is not None},
        principal=principal,
    )
    row.usage_count = (row.usage_count or 0) + 1
    _label(session, created["id"], row.labels, principal=principal)
    session.flush()
    return created


def _label(session, task_id: str, labels, *, principal) -> None:
    """Put the template's labels on the copy — the ones the vocabulary knows."""
    if not labels:
        return
    from src.models.content import Tag
    from src.services.records import tags

    if not principal.can(tags.APPLY_PERMISSION):
        return
    slugs = [tags.slugify(item) for item in labels]
    known = session.scalars(select(Tag.slug).where(Tag.slug.in_(slugs))).all()
    if known:
        tags.apply(session, "task", task_id, {"tags": list(known)}, principal=principal)


def save_as_template(session, task_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    task = _task(session, task_id)
    body = payload if isinstance(payload, dict) else {}
    first, last = as_day(task.start_date), as_day(task.due_date)
    data = {
        "name": body.get("name") or task.title,
        "title": task.title,
        "description": task.description,
        "kind": task.kind if task.kind != "EPIC" else "TASK",
        "priority": task.priority,
        "estimate_hours": task.estimate_hours,
        "story_points": task.story_points,
        "checklist": task.checklist or [],
        "labels": list(task.tags or []),
        "cover_color": task.cover_color,
        "due_in_days": (last - first).days if first and last else None,
    }
    return create_template(session, data, principal=principal)
