"""Placing a task in the backlog order."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.clock import now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.services.work.sprints.metrics import _MIN_GAP, MANAGE, STEP, _sprint, card
from src.services.work.sprints.writing import _body


def place(session, payload: Any, *, principal) -> dict[str, Any]:
    """Drop a task into a sprint or the backlog, between two neighbours."""
    from src.models.business import Task

    principal.require(MANAGE)
    body = _body(payload)
    task = session.scalars(
        select(Task).where(
            Task.id == parse_uuid(body.get("task_id"), field="task_id"), Task.deleted_at.is_(None)
        )
    ).unique().first()
    if task is None:
        raise NotFoundError("No task with that id.", details={"task_id": str(body.get("task_id"))})
    sprint = _sprint(session, body["sprint_id"]) if body.get("sprint_id") else None
    if sprint is not None and sprint.state == "COMPLETED":
        raise ConflictError(f"{sprint.name} is finished; plan into a later sprint.", details={"state": sprint.state})

    before_sprint = task.sprint_id
    target = sprint.id if sprint else None
    if before_sprint != target:
        task.sprint_id = target
        task.sprint_added_at = now() if target else None

    container = select(Task).where(
        Task.deleted_at.is_(None), Task.id != task.id,
        Task.sprint_id == target if target else Task.sprint_id.is_(None),
    )
    after = _neighbour(session, body.get("after_id"), task)
    before = _neighbour(session, body.get("before_id"), task)
    rank = _rank(session, container, after, before)
    if rank is None:
        rows = session.scalars(container.order_by(Task.backlog_rank.asc(), Task.id.asc())).unique().all()
        for index, item in enumerate(rows, start=1):
            item.backlog_rank = index * STEP
        session.flush()
        rank = _rank(session, container, after, before)
    task.backlog_rank = rank if rank is not None else STEP
    session.flush()

    if before_sprint != target:
        audit.record(
            session, action="UPDATE", resource_type="task", resource_id=task.id,
            resource_label=task.reference, principal=principal,
            before={"sprint_id": str(before_sprint) if before_sprint else None},
            after={"sprint_id": str(target) if target else None},
            message=f"moved {task.reference} to {sprint.name if sprint else 'the backlog'}",
        )
    return card(task)


def _neighbour(session, raw: Any, task):
    from src.models.business import Task

    if not raw:
        return None
    identifier = parse_uuid(raw, field="neighbour")
    if identifier == task.id:
        raise ValidationError("A task cannot be placed next to itself.", details={"neighbour": str(raw)})
    row = session.scalars(select(Task).where(Task.id == identifier, Task.deleted_at.is_(None))).unique().first()
    if row is None or row.sprint_id != task.sprint_id:
        return None
    return row


def _rank(session, container, after, before) -> float | None:
    from src.models.business import Task

    if after is not None and before is None:
        before = session.scalars(
            container.where(Task.backlog_rank > after.backlog_rank).order_by(Task.backlog_rank.asc())
        ).unique().first()
    elif before is not None and after is None:
        after = session.scalars(
            container.where(Task.backlog_rank < before.backlog_rank).order_by(Task.backlog_rank.desc())
        ).unique().first()
    elif after is None and before is None:
        before = session.scalars(container.order_by(Task.backlog_rank.asc())).unique().first()
    low = float(after.backlog_rank) if after is not None else None
    high = float(before.backlog_rank) if before is not None else None
    if low is None and high is None:
        return STEP
    if high is None:
        return low + STEP
    if low is None:
        return high - STEP
    if high - low <= _MIN_GAP:
        return None
    return low + (high - low) / 2
