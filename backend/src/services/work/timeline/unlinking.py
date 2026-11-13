"""Removing a dependency, and adding one."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.errors import ConflictError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.services.records import writes as record_writes
from src.services.work.timeline.paths import _link
from src.services.work.timeline.scheduling import _reaches, _task
from src.services.work.timeline.spans import span_of


def link(session, payload: Any, *, principal) -> dict[str, Any]:
    """Draw a finish-to-start dependency between two tasks."""
    from src.models.planning import TaskDependency

    principal.require(record_writes.UPDATE_PERMISSION)
    body = payload if isinstance(payload, dict) else {}
    pred = _task(session, body.get("predecessor_id"), "predecessor_id")
    succ = _task(session, body.get("successor_id"), "successor_id")
    if pred.id == succ.id:
        raise ValidationError("A task cannot wait on itself.", details={"task_id": str(pred.id)})
    try:
        lag = int(body.get("lag_days") or 0)
    except (TypeError, ValueError) as exc:
        raise ValidationError("The lag is a whole number of days.", details={"lag_days": body.get("lag_days")}) from exc
    if not -365 <= lag <= 365:
        raise ValidationError("The lag is at most a year either way.", details={"lag_days": lag})
    existing = session.scalars(
        select(TaskDependency).where(
            TaskDependency.predecessor_id == pred.id, TaskDependency.successor_id == succ.id
        )
    ).first()
    if existing is not None:
        raise ConflictError(
            f"{succ.reference} already waits on {pred.reference}.",
            details={"dependency_id": str(existing.id)},
        )
    if _reaches(session, succ.id, pred.id):
        raise ValidationError(
            f"{pred.reference} already waits on {succ.reference}, so this would be a loop.",
            details={"predecessor_id": str(pred.id), "successor_id": str(succ.id)},
        )
    row = TaskDependency(
        predecessor_id=pred.id, successor_id=succ.id, kind="FS", lag_days=lag,
        created_by_id=principal.user_id,
    )
    session.add(row)
    session.flush()
    audit.record(
        session, action="UPDATE", resource_type="task", resource_id=succ.id,
        resource_label=succ.reference, principal=principal,
        after={"waits_on": pred.reference, "lag_days": lag},
        message=f"made {succ.reference} wait on {pred.reference}",
    )
    spans = {pred.id: span_of(pred), succ.id: span_of(succ)}
    return _link(row, spans) | {
        "predecessor": {"reference": pred.reference, "title": pred.title},
        "successor": {"reference": succ.reference, "title": succ.title},
    }


def unlink(session, dependency_id: Any, *, principal) -> dict[str, Any]:
    from src.models.planning import TaskDependency

    principal.require(record_writes.UPDATE_PERMISSION)
    identifier = parse_uuid(dependency_id, field="dependency_id")
    row = get_or_404(
        session,
        TaskDependency,
        identifier,
        "No dependency with that id.",
        details={"dependency_id": str(dependency_id)},
    )
    succ = _task(session, row.successor_id)
    pred = _task(session, row.predecessor_id)
    session.delete(row)
    session.flush()
    audit.record(
        session, action="UPDATE", resource_type="task", resource_id=succ.id,
        resource_label=succ.reference, principal=principal,
        before={"waits_on": pred.reference},
        message=f"{succ.reference} no longer waits on {pred.reference}",
    )
    return {"id": str(identifier), "deleted": True}
