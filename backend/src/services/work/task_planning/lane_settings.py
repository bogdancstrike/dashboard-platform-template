"""Setting a board's lanes, and its epics."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core import audit, vocabulary
from src.core.clock import now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.services.work.sprints import MANAGE, READ, card
from src.services.work.task_planning.board_planning import lanes


def set_lanes(session, payload: Any, *, principal) -> dict[str, Any]:
    """`{"IN_PROGRESS": 8, "IN_REVIEW": null}` — a limit per lane; null is none."""
    from src.models.planning import TaskLaneSetting

    principal.require(MANAGE)
    body = payload if isinstance(payload, dict) else {}
    limits = body.get("limits", body)
    if not isinstance(limits, dict) or not limits:
        raise ValidationError("Name at least one lane and its limit.", details={})
    for status, raw in limits.items():
        if status not in vocabulary.TASK_STATUS:
            raise ValidationError(f"{status} is not a lane on the task board.", details={"status": status})
        value = None
        if raw not in (None, ""):
            try:
                value = int(raw)
            except (TypeError, ValueError) as exc:
                raise ValidationError("A limit is a whole number.", details={"status": status, "value": raw}) from exc
            if value < 1 or value > 999:
                raise ValidationError("A limit is between 1 and 999 — clear it for none.", details={"status": status})
        row = session.get(TaskLaneSetting, status)
        if row is None:
            row = TaskLaneSetting(status=status)
            session.add(row)
        row.wip_limit = value
        row.updated_at = now()
    session.flush()
    audit.record(
        session, action="CONFIGURATION_CHANGE", resource_type="task_board",
        resource_label="Task board", principal=principal, after={"wip_limits": limits},
        message="changed the task board's lane limits", activity=False,
    )
    return lanes(session, principal=principal)


def epics(session, args: dict[str, Any], *, principal) -> dict[str, Any]:
    """Every epic, with how far along its work is."""
    from src.models.business import Task

    principal.require(READ)
    statement = select(Task).where(Task.deleted_at.is_(None), Task.kind == "EPIC")
    if args.get("project_id"):
        statement = statement.where(Task.project_id == parse_uuid(args["project_id"], field="project_id"))
    rows = session.scalars(statement.order_by(Task.title)).unique().all()
    ids = [row.id for row in rows]
    totals: dict[Any, tuple[int, int, float]] = {}
    if ids:
        for epic_id, total, done, points in session.execute(
            select(
                Task.epic_id,
                func.count(),
                func.count().filter(Task.status == "DONE"),
                func.coalesce(func.sum(Task.story_points), 0),
            )
            .where(Task.epic_id.in_(ids), Task.deleted_at.is_(None))
            .group_by(Task.epic_id)
        ).all():
            totals[epic_id] = (int(total), int(done), float(points))
    return {
        "items": [
            {
                **card(row),
                "children": totals.get(row.id, (0, 0, 0.0))[0],
                "children_done": totals.get(row.id, (0, 0, 0.0))[1],
                "points": totals.get(row.id, (0, 0, 0.0))[2],
            }
            for row in rows
        ]
    }
