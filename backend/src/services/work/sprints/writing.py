"""Creating, changing, removing and starting sprints."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select

from src.core import audit
from src.core.clock import now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.services.work.sprints.metrics import (
    DEFAULT_LENGTH_DAYS,
    MANAGE,
    _scope,
    _sprint,
    stats,
    summary,
)
from src.services.work.timeline import as_day


def _body(payload: Any) -> dict[str, Any]:
    return payload if isinstance(payload, dict) else {}


def _capacity(raw: Any) -> Decimal | None:
    if raw is None or raw == "":
        return None
    try:
        value = Decimal(str(raw))
    except Exception as exc:  # noqa: BLE001 - any unparsable value is the same answer
        raise ValidationError("Capacity is a number of points.", details={"capacity_points": raw}) from exc
    if value < 0 or value > 9999:
        raise ValidationError("Capacity is between 0 and 9999 points.", details={"capacity_points": raw})
    return value


def create(session, payload: Any, *, principal) -> dict[str, Any]:
    from src.models.business import Project
    from src.models.planning import Sprint

    principal.require(MANAGE)
    body = _body(payload)
    project_id = parse_uuid(body["project_id"], field="project_id") if body.get("project_id") else None
    if project_id and session.get(Project, project_id) is None:
        raise NotFoundError("No project with that id.", details={"project_id": str(project_id)})
    count = session.scalar(
        select(func.count()).select_from(Sprint).where(Sprint.project_id == project_id)
    ) or 0
    name = (body.get("name") or "").strip() or f"Sprint {count + 1}"
    start = as_day(body.get("start_date"))
    end = as_day(body.get("end_date"))
    if start and not end:
        end = start + timedelta(days=DEFAULT_LENGTH_DAYS - 1)
    _check_window(start, end)
    row = Sprint(
        project_id=project_id,
        name=name[:120],
        goal=(body.get("goal") or None),
        state="PLANNED",
        start_date=start,
        end_date=end,
        capacity_points=_capacity(body.get("capacity_points")),
        created_by_id=principal.user_id,
    )
    session.add(row)
    session.flush()
    _audit(session, row, "CREATE", principal, f"planned {row.name}")
    return summary(session, row, [])


def _check_window(start: date | None, end: date | None) -> None:
    if start and end and end < start:
        raise ValidationError(
            "A sprint cannot end before it starts.",
            details={"start_date": start.isoformat(), "end_date": end.isoformat()},
        )


def update(session, sprint_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    row = _sprint(session, sprint_id)
    body = _body(payload)
    if "name" in body:
        name = (body.get("name") or "").strip()
        if not name:
            raise ValidationError("A sprint needs a name.", details={"name": ""})
        row.name = name[:120]
    if "goal" in body:
        row.goal = body.get("goal") or None
    if "start_date" in body:
        row.start_date = as_day(body.get("start_date"))
    if "end_date" in body:
        row.end_date = as_day(body.get("end_date"))
    if "capacity_points" in body:
        row.capacity_points = _capacity(body.get("capacity_points"))
    _check_window(row.start_date, row.end_date)
    session.flush()
    _audit(session, row, "UPDATE", principal, f"changed {row.name}")
    return summary(session, row)


def remove(session, sprint_id: Any, *, principal) -> dict[str, Any]:
    """Delete a sprint that has not started; its tasks go back to the backlog."""
    principal.require(MANAGE)
    row = _sprint(session, sprint_id)
    if row.state != "PLANNED":
        raise ConflictError(
            "Only a sprint that has not started can be deleted — complete it instead.",
            details={"state": row.state},
        )
    released = 0
    for task in _scope(session, row.id):
        task.sprint_id = None
        task.sprint_added_at = None
        released += 1
    row.deleted_at = now()
    session.flush()
    _audit(session, row, "DELETE", principal, f"deleted {row.name}")
    return {"id": str(row.id), "deleted": True, "released": released}


def start(session, sprint_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    from src.models.planning import Sprint

    principal.require(MANAGE)
    row = _sprint(session, sprint_id)
    if row.state != "PLANNED":
        raise ConflictError(f"{row.name} has already started.", details={"state": row.state})
    running = session.scalars(
        select(Sprint).where(
            Sprint.deleted_at.is_(None), Sprint.state == "ACTIVE",
            Sprint.project_id == row.project_id if row.project_id else Sprint.project_id.is_(None),
        )
    ).first()
    if running is not None:
        raise ConflictError(
            f"{running.name} is still running — complete it before starting another.",
            details={"active_sprint_id": str(running.id)},
        )
    body = _body(payload)
    today = now().date()
    row.start_date = as_day(body.get("start_date")) or row.start_date or today
    row.end_date = as_day(body.get("end_date")) or row.end_date or row.start_date + timedelta(days=DEFAULT_LENGTH_DAYS - 1)
    if body.get("goal"):
        row.goal = body["goal"]
    _check_window(row.start_date, row.end_date)
    tasks = _scope(session, row.id)
    row.state = "ACTIVE"
    row.started_at = now()
    row.committed_points = Decimal(str(stats(tasks)["total_points"]))
    session.flush()
    snapshot(session, row, today)
    _audit(session, row, "UPDATE", principal, f"started {row.name}")
    return summary(session, row, tasks)


def snapshot(session, row, day: date) -> None:
    """Record (or refresh) one day of a sprint's burndown."""
    from src.models.planning import SprintSnapshot

    numbers = stats(_scope(session, row.id))
    existing = session.scalars(
        select(SprintSnapshot).where(SprintSnapshot.sprint_id == row.id, SprintSnapshot.day == day)
    ).first()
    if existing is None:
        existing = SprintSnapshot(sprint_id=row.id, day=day)
        session.add(existing)
    existing.total_points = Decimal(str(numbers["total_points"]))
    existing.done_points = Decimal(str(numbers["done_points"]))
    existing.remaining_points = Decimal(str(numbers["remaining_points"]))
    existing.total_tasks = numbers["total_tasks"]
    existing.done_tasks = numbers["done_tasks"]
    session.flush()


def _audit(session, row, action: str, principal, message: str) -> None:
    audit.record(
        session, action=action, resource_type="sprint", resource_id=row.id,
        resource_label=row.name, principal=principal,
        after={"state": row.state, "name": row.name}, message=message,
        project_id=row.project_id,
    )
