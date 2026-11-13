"""The timeline: bars, dependencies and groupings."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import and_, or_, select

from src.core.clock import now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.services.records import writes as record_writes
from src.services.work.timeline.paths import _link, _name, _person, critical_path
from src.services.work.timeline.spans import (
    GROUPINGS,
    MAX_BARS,
    as_day,
    at_midnight,
    span_of,
)


def timeline(session, args: dict[str, Any], *, principal) -> dict[str, Any]:
    """Bars, groups, dependencies and the critical path for a window of time."""
    from src.models.business import Project, Task
    from src.models.planning import TaskDependency

    principal.require("tasks.view")
    group = (args.get("group") or "project").lower()
    if group not in GROUPINGS:
        raise ValidationError(
            f"A timeline groups by {', '.join(GROUPINGS)}.", details={"group": group}
        )
    today = now().date()
    start = as_day(args.get("from")) or today - timedelta(days=30)
    end = as_day(args.get("to")) or today + timedelta(days=120)
    if end < start:
        raise ValidationError("The window ends before it starts.", details={"from": str(start), "to": str(end)})
    project_ids = [parse_uuid(item, field="project_id") for item in _many(args.get("project_id"))]
    include_done = str(args.get("include_done", "true")).lower() not in ("false", "0", "no")
    term = (args.get("q") or "").strip()

    lo, hi = at_midnight(start), at_midnight(end + timedelta(days=1))
    statement = select(Task).where(Task.deleted_at.is_(None), Task.status != "CANCELLED")
    if project_ids:
        statement = statement.where(Task.project_id.in_(project_ids))
    else:
        # Anything whose bar touches the window: started before it ends and
        # due after it begins — with a missing end standing in for the other.
        statement = statement.where(
            or_(
                and_(Task.start_date < hi, Task.due_date >= lo),
                and_(Task.start_date.is_(None), Task.due_date >= lo, Task.due_date < hi),
                and_(Task.due_date.is_(None), Task.start_date >= lo, Task.start_date < hi),
            )
        )
    if not include_done:
        statement = statement.where(Task.status != "DONE")
    if term:
        like = f"%{term}%"
        statement = statement.where(or_(Task.title.ilike(like), Task.reference.ilike(like)))
    statement = statement.order_by(Task.start_date.asc().nulls_last(), Task.due_date.asc().nulls_last(), Task.reference)
    rows = session.scalars(statement.limit(MAX_BARS + 1)).unique().all()
    truncated = len(rows) > MAX_BARS
    rows = rows[:MAX_BARS]
    ids = [row.id for row in rows]

    links = session.scalars(
        select(TaskDependency).where(
            TaskDependency.predecessor_id.in_(ids), TaskDependency.successor_id.in_(ids)
        )
    ).all() if ids else []

    spans = {row.id: span_of(row) for row in rows}
    critical = critical_path(
        {key: (value[0], value[1]) for key, value in spans.items()},
        [(link.predecessor_id, link.successor_id, link.lag_days) for link in links],
    )

    epic_ids = {row.epic_id for row in rows if row.epic_id}
    epics = {
        item.id: item
        for item in session.scalars(select(Task).where(Task.id.in_(epic_ids))).all()
    } if epic_ids else {}
    project_rows = {
        item.id: item
        for item in session.scalars(
            select(Project).where(Project.id.in_({row.project_id for row in rows if row.project_id}))
        ).unique().all()
    } if rows else {}

    def bar(row) -> dict[str, Any]:
        first, last, planned = spans[row.id]
        return {
            "id": str(row.id),
            "reference": row.reference,
            "title": row.title,
            "status": row.status,
            "priority": row.priority,
            "kind": row.kind,
            "start": first.isoformat(),
            "end": last.isoformat(),
            "scheduled": planned,
            "progress": int(row.progress or 0),
            "is_milestone": bool(row.is_milestone),
            "story_points": float(row.story_points) if row.story_points is not None else None,
            "project_id": str(row.project_id) if row.project_id else None,
            "epic_id": str(row.epic_id) if row.epic_id else None,
            "assignee": _person(row.assignee),
            "cover_color": row.cover_color,
            "critical": row.id in critical,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }

    buckets: dict[str, dict[str, Any]] = {}
    for row in rows:
        if group == "project":
            project = project_rows.get(row.project_id)
            key = str(row.project_id) if project else "none"
            if key not in buckets:
                buckets[key] = {
                    "key": key,
                    "label": project.name if project else "No project",
                    "code": project.code if project else None,
                    "color": project.color if project else None,
                    "start": as_day(project.start_date).isoformat() if project and project.start_date else None,
                    "end": as_day(project.due_date).isoformat() if project and project.due_date else None,
                    "progress": int(project.progress or 0) if project else None,
                    "items": [],
                }
        elif group == "epic":
            epic = epics.get(row.epic_id)
            if row.kind == "EPIC":
                epic = row
            key = str(epic.id) if epic else "none"
            if key not in buckets:
                buckets[key] = {
                    "key": key,
                    "label": epic.title if epic else "No epic",
                    "code": epic.reference if epic else None,
                    "color": epic.cover_color if epic else None,
                    "start": None, "end": None, "progress": int(epic.progress or 0) if epic else None,
                    "items": [],
                }
        else:
            person = row.assignee
            key = str(person.id) if person else "none"
            if key not in buckets:
                buckets[key] = {
                    "key": key,
                    "label": _name(person) if person else "Unassigned",
                    "code": None, "color": None, "start": None, "end": None, "progress": None,
                    "items": [],
                }
        buckets[key]["items"].append(bar(row))

    groups = sorted(buckets.values(), key=lambda item: (item["key"] == "none", item["label"].lower()))
    for item in groups:
        firsts = [entry["start"] for entry in item["items"]]
        lasts = [entry["end"] for entry in item["items"]]
        item["start"] = item["start"] or min(firsts)
        item["end"] = item["end"] or max(lasts)
        item["count"] = len(item["items"])

    return {
        "group": group,
        "range": {"from": start.isoformat(), "to": end.isoformat(), "today": today.isoformat()},
        "groups": groups,
        "dependencies": [
            _link(link, spans)
            for link in links
        ],
        "critical_path": [str(item) for item in ids if item in critical],
        "total": len(rows),
        "truncated": truncated,
        "can_edit": principal.can(record_writes.UPDATE_PERMISSION),
    }


def _many(raw: Any) -> list[str]:
    if raw is None or raw == "":
        return []
    if isinstance(raw, (list, tuple)):
        return [str(item) for item in raw if item]
    return [item for item in str(raw).split(",") if item]
