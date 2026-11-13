"""Changing an organization, and creating departments."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit, vocabulary
from src.core.errors import ConflictError, ValidationError
from src.services.people.organizations.common import (
    MANAGE_PERMISSION,
    MAX_DEPTH,
    VIEW_PERMISSION,
    _checked_code,
    _checked_name,
    _people_by_organization,
    _slug,
    summarise,
)
from src.services.people.organizations.listing_view import _department, _organization


def update(session, organization_id: str, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Edit a tenant's own details."""
    principal.require(VIEW_PERMISSION, MANAGE_PERMISSION)
    row = _organization(session, organization_id)

    before = {"name": row.name, "tier": row.tier, "status": row.status}
    if "name" in payload:
        row.name = _checked_name(payload.get("name"))
        row.slug = _slug(row.name)
    if "tier" in payload:
        row.tier = _one_of(payload.get("tier"), vocabulary.ORG_TIER, "tier")
    if "status" in payload:
        row.status = _one_of(payload.get("status"), vocabulary.ORG_STATUS, "status")
    for field in ("legal_name", "industry", "website", "email", "phone", "address_line", "city", "country"):
        if field in payload:
            setattr(row, field, str(payload.get(field) or "").strip() or None)
    if "employee_count" in payload:
        row.employee_count = _positive(payload.get("employee_count"), "employee_count")

    audit.record(
        session,
        action="UPDATE",
        resource_type="organization",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        before=before,
        after={"name": row.name, "tier": row.tier, "status": row.status},
        message=f"edited {row.name}",
    )
    session.flush()
    return summarise(
        row,
        people=_people_by_organization(session, [row.id]).get(row.id, 0),
        # The caller holds `orgs.manage` to have got here at all.
        commercial=True,
    )


def _one_of(value: Any, allowed: tuple[str, ...], field: str) -> str:
    wanted = str(value or "").strip().upper()
    if wanted not in allowed:
        raise ValidationError(
            f"{wanted!r} is not a {field}.",
            details={"value": wanted, "allowed": list(allowed)},
        )
    return wanted


def _positive(value: Any, field: str) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValidationError(f"{field} must be a whole number.") from None
    if number < 0:
        raise ValidationError(f"{field} cannot be negative.")
    return number


def create_department(
    session, organization_id: str, payload: dict[str, Any], *, principal
) -> dict[str, Any]:
    """Add a department, optionally inside another."""
    principal.require(VIEW_PERMISSION, MANAGE_PERMISSION)
    from src.models.identity import Department

    organization = _organization(session, organization_id)
    name = _checked_name(payload.get("name"))
    code = _checked_code(payload.get("code"))

    parent = None
    if payload.get("parent_id"):
        parent = _department(session, str(payload["parent_id"]))
        if parent.organization_id != organization.id:
            raise ValidationError(
                "A department cannot sit inside one from another organization.",
                details={"parent_id": str(parent.id)},
            )
        if _depth_of(session, parent) + 1 >= MAX_DEPTH:
            raise ConflictError(
                f"{MAX_DEPTH} levels is as deep as the structure goes — "
                "past that nobody can read the indentation.",
                details={"max_depth": MAX_DEPTH},
            )

    clash = session.scalar(
        select(Department).where(
            Department.organization_id == organization.id,
            Department.code == code,
            Department.deleted_at.is_(None),
        )
    )
    if clash is not None:
        raise ConflictError(
            f"{organization.name} already has a {code} — {clash.name}.",
            details={"code": code, "existing": str(clash.id)},
        )

    row = Department(
        name=name,
        code=code,
        description=str(payload.get("description") or "").strip() or None,
        organization_id=organization.id,
        parent_id=parent.id if parent else None,
        cost_center=str(payload.get("cost_center") or "").strip() or None,
        # Derived, always: see `_people_by_department`. Nobody is in it yet.
        headcount=0,
    )
    session.add(row)
    session.flush()

    audit.record(
        session,
        action="CREATE",
        resource_type="department",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        after={"name": row.name, "code": row.code, "parent_id": str(row.parent_id or "")},
        message=f"added {row.name} to {organization.name}",
    )
    return {
        "id": str(row.id),
        "name": row.name,
        "code": row.code,
        "parent_id": str(row.parent_id) if row.parent_id else None,
        "people": 0,
    }


def _depth_of(session, row) -> int:
    """How far down a department already sits.

    Walks upward with a visit set rather than trusting the structure: this is
    the function that has to be safe when a cycle exists, since it is what
    prevents one being created.
    """
    from src.models.identity import Department

    depth = 0
    seen = {row.id}
    current = row
    while current.parent_id is not None and depth < MAX_DEPTH + 2:
        if current.parent_id in seen:
            break
        seen.add(current.parent_id)
        current = session.get(Department, current.parent_id)
        if current is None:
            break
        depth += 1
    return depth
