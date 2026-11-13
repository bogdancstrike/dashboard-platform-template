"""Creating the next occurrence of recurring tasks."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.clock import now
from src.services.records import writes as record_writes
from src.services.work.task_templates.recurrence_rules import next_after
from src.services.work.task_templates.template_store import MAX_CATCH_UP
from src.services.work.timeline import as_day, at_midnight


def occurrence(session, rule, source, when: datetime):
    """One copy of the source task, due on `when`."""
    from src.models.business import Task
    from src.services.records.explorer import resource_for

    resource = resource_for("task")
    first, last = as_day(source.start_date), as_day(source.due_date)
    length = (last - first).days if first and last else 0
    due_day = when.date()
    values = {
        "reference": record_writes._next_identifier(session, resource),
        "title": source.title,
        "description": source.description,
        "status": "NEW",
        "priority": source.priority,
        "kind": source.kind,
        "project_id": source.project_id,
        "organization_id": source.organization_id,
        "assignee_id": source.assignee_id,
        "requester_id": source.requester_id,
        "epic_id": source.epic_id,
        "estimate_hours": source.estimate_hours,
        "story_points": source.story_points,
        "cover_color": source.cover_color,
        "checklist": [
            {"text": item.get("text") or item.get("label") or "", "done": False}
            for item in (source.checklist or []) if isinstance(item, dict)
        ] or None,
        "start_date": at_midnight(due_day - timedelta(days=length)),
        "due_date": at_midnight(due_day),
        "recurrence_id": rule.id,
        "progress": 0,
        "logged_hours": 0,
        "board_position": 0,
        "backlog_rank": 0,
        "metadata_json": {"source": "recurrence", "series": source.reference},
    }
    row = Task(**values)
    session.add(row)
    session.flush()
    audit.record(
        session, action="CREATE", resource_type="task", resource_id=row.id,
        resource_label=row.reference, principal=None,
        after={"title": row.title, "recurs_from": source.reference},
        message=f"created {row.reference}, the next {source.reference}",
    )
    return row


def run_recurrences(session, moment: datetime | None = None) -> dict[str, Any]:
    """Make every occurrence that has come due; move each rule on."""
    from src.models.business import Task
    from src.models.planning import TaskRecurrence

    moment = moment or now()
    rules = session.scalars(
        select(TaskRecurrence).where(
            TaskRecurrence.active.is_(True),
            TaskRecurrence.next_run_at.is_not(None),
            TaskRecurrence.next_run_at <= moment,
        )
    ).all()
    made: list[str] = []
    for rule in rules:
        source = session.scalars(
            select(Task).where(Task.id == rule.task_id, Task.deleted_at.is_(None))
        ).unique().first()
        if source is None:
            rule.active = False
            rule.next_run_at = None
            continue
        count = 0
        while rule.next_run_at is not None and rule.next_run_at <= moment and count < MAX_CATCH_UP:
            row = occurrence(session, rule, source, rule.next_run_at)
            made.append(row.reference)
            rule.occurrences = (rule.occurrences or 0) + 1
            rule.last_run_at = moment
            rule.next_run_at = next_after(rule, rule.next_run_at)
            count += 1
        # Anything still overdue after the cap is skipped, not made later.
        while rule.next_run_at is not None and rule.next_run_at <= moment:
            rule.next_run_at = next_after(rule, rule.next_run_at)
        if rule.next_run_at is None:
            rule.active = False
    session.flush()
    return {"rules": len(rules), "created": made}
