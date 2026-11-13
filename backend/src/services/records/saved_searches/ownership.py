"""Transferring a search, the sole default, and who sees which."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.services.records.saved_searches.access import SHARE_PERMISSION, _owned_visible
from src.services.records.saved_searches.serializers import (
    _member_ids,
    _replace_members,
    _serialize,
    _state,
)


def transfer(session, search_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Hand a saved search to somebody else (§5).

    An explicit action rather than a field on `update`, because it is the one
    change the current owner cannot undo: afterwards they are a member like any
    other. They are kept as a member for exactly that reason — losing sight of
    a search you built, the moment you hand it over, is not a handover anybody
    would risk making.
    """
    from src.models.identity import User

    row = _owned_visible(session, search_id, principal)
    principal.require(SHARE_PERMISSION)
    if not isinstance(payload, dict):
        raise ValidationError("The transfer must be a JSON object.")

    new_owner_id = parse_uuid(payload.get("owner_id"), field="owner_id")
    if new_owner_id == row.owner_id:
        raise ValidationError("This saved search already belongs to that person.")
    new_owner = session.scalars(
        select(User).where(
            User.id == new_owner_id, User.deleted_at.is_(None), User.status == "ACTIVE"
        )
    ).one_or_none()
    if new_owner is None:
        raise ValidationError(
            "That person cannot receive a saved search.",
            details={"owner_id": str(new_owner_id)},
        )

    before = _state(row)
    previous_owner_id = row.owner_id
    # Assigned through the relationship, not the raw column: the serializer
    # reads `row.owner`, and setting only the id leaves it pointing at the
    # person who just gave the search away.
    row.owner = new_owner
    # The new owner needs no share of their own, and the old one keeps a
    # read-only place on the list they used to own.
    members = [str(user_id) for user_id in _member_ids(session, row) if user_id != new_owner_id]
    members.append(str(previous_owner_id))
    session.flush()
    _replace_members(session, row, members, principal=principal, owner_id=new_owner_id)

    audit.record(
        session, action="TRANSFER", resource_type="saved_search", resource_id=row.id,
        resource_label=row.name, principal=principal, before=before, after=_state(row),
        metadata={"from_owner_id": str(previous_owner_id), "to_owner_id": str(new_owner_id)},
        message=f"transferred saved search {row.name} to {new_owner.full_name}",
        activity=False,
    )
    return _serialize(session, row, principal)
