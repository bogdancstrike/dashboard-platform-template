"""Moving and removing departments."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core import audit
from src.core.clock import now
from src.core.errors import ConflictError, ValidationError
from src.services.people.organizations.common import (
    MANAGE_PERMISSION,
    MAX_DEPTH,
    VIEW_PERMISSION,
    _checked_code,
    _checked_name,
)
from src.services.people.organizations.listing_view import _department


def move_department(
    session, department_id: str, payload: dict[str, Any], *, principal
) -> dict[str, Any]:
    """Re-parent a department, or edit it.

    The one edit that can corrupt the structure. A department that became its
    own ancestor would make the tree infinite and hang every page that walks
    it, so the cycle is refused with the offending path named — a bare "invalid
    parent" leaves somebody guessing which of four levels was the problem.
    """
    principal.require(VIEW_PERMISSION, MANAGE_PERMISSION)
    row = _department(session, department_id)

    before = {"name": row.name, "code": row.code, "parent_id": str(row.parent_id or "")}
    if "name" in payload:
        row.name = _checked_name(payload.get("name"))
    if "code" in payload:
        row.code = _checked_code(payload.get("code"))
    if "description" in payload:
        row.description = str(payload.get("description") or "").strip() or None
    if "cost_center" in payload:
        row.cost_center = str(payload.get("cost_center") or "").strip() or None

    if "parent_id" in payload:
        wanted = payload.get("parent_id")
        if not wanted:
            row.parent_id = None
        else:
            parent = _department(session, str(wanted))
            if parent.id == row.id:
                raise ConflictError(
                    f"{row.name} cannot sit inside itself.",
                    details={"department": str(row.id)},
                )
            if parent.organization_id != row.organization_id:
                raise ValidationError(
                    "A department cannot move into another organization.",
                    details={"parent_id": str(parent.id)},
                )
            path = _ancestry(session, parent)
            if row.id in {item.id for item in path}:
                raise ConflictError(
                    f"That would put {row.name} inside itself — "
                    + " → ".join(item.name for item in reversed(path)),
                    details={"path": [str(item.id) for item in path]},
                )
            if len(path) >= MAX_DEPTH:
                raise ConflictError(
                    f"{MAX_DEPTH} levels is as deep as the structure goes.",
                    details={"max_depth": MAX_DEPTH},
                )
            row.parent_id = parent.id

    audit.record(
        session,
        action="UPDATE",
        resource_type="department",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        before=before,
        after={"name": row.name, "code": row.code, "parent_id": str(row.parent_id or "")},
        message=f"edited {row.name}",
    )
    session.flush()
    return {
        "id": str(row.id),
        "name": row.name,
        "code": row.code,
        "parent_id": str(row.parent_id) if row.parent_id else None,
    }


def _ancestry(session, row) -> list:
    """A department and everything above it, nearest first.

    Bounded by `MAX_DEPTH + 2` rather than trusting termination: if a cycle
    ever did exist, the function that detects cycles must not be the one that
    hangs on them.
    """
    from src.models.identity import Department

    chain = [row]
    current = row
    while current.parent_id is not None and len(chain) < MAX_DEPTH + 2:
        parent = session.get(Department, current.parent_id)
        if parent is None or parent.id in {item.id for item in chain}:
            break
        chain.append(parent)
        current = parent
    return chain


def remove_department(session, department_id: str, *, principal) -> dict[str, Any]:
    """Retire a department, refusing while anything is still inside it.

    Unlike a group — which is a set of people and can be dissolved — a
    department is a *place*: users and teams point at it, and the foreign keys
    cascade. A silent delete would take the teams with it and leave the people
    pointing at nothing, so this says what is in the way instead.
    """
    principal.require(VIEW_PERMISSION, MANAGE_PERMISSION)
    from src.models.identity import Department, Team, User

    row = _department(session, department_id)

    people = int(
        session.scalar(
            select(func.count())
            .select_from(User)
            .where(User.department_id == row.id, User.deleted_at.is_(None))
        )
        or 0
    )
    teams = int(
        session.scalar(
            select(func.count())
            .select_from(Team)
            .where(Team.department_id == row.id, Team.deleted_at.is_(None))
        )
        or 0
    )
    children = int(
        session.scalar(
            select(func.count())
            .select_from(Department)
            .where(Department.parent_id == row.id, Department.deleted_at.is_(None))
        )
        or 0
    )

    blocking = [
        label
        for label, count in (
            (f"{people} {'person' if people == 1 else 'people'}", people),
            (f"{teams} {'team' if teams == 1 else 'teams'}", teams),
            (f"{children} sub-{'department' if children == 1 else 'departments'}", children),
        )
        if count
    ]
    if blocking:
        raise ConflictError(
            f"{row.name} still has {', '.join(blocking)}. Move them first.",
            details={"people": people, "teams": teams, "children": children},
        )

    label = row.name
    row.deleted_at = now()
    audit.record(
        session,
        action="DELETE",
        resource_type="department",
        resource_id=row.id,
        resource_label=label,
        principal=principal,
        message=f"retired {label}",
    )
    session.flush()
    return {"deleted": True, "id": str(row.id), "name": label}
