"""One sharing model, for everything a person can save (§5, §28, §45, §46).

Saved searches, reports, saved views and dashboards all answer the same three
questions — who can see this, who can change it, and how does the owner hand it
over — and the tracker's requirement is explicit: *one mechanism, one table,
one set of rules; a second sharing model is a second set of bugs*.

So the rules live here rather than in each service:

* **Private by default.** Nothing is shared by accident.
* **Shared** means the owner plus explicitly added members, who may read and
  run it and nothing more.
* **Public** means every signed-in person can see it. Member rows are kept, so
  flipping back to Shared restores exactly the previous audience instead of
  losing it.
* **Only the owner writes.** A member who wants their own version duplicates
  it, and the copy is theirs and private.

Visibility is one SQL predicate — `owner = me OR scope = PUBLIC OR id IN (my
shares)` — rather than fetching everything and filtering in Python, because the
alternative reads the whole table to show somebody three rows (§71).

`resource_shares` is polymorphic (`resource_type`, `resource_id`, `user_id`),
so adopting this for a new kind of saved thing costs a string, not a table.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import String, cast, delete, or_, select

from src.core.errors import ForbiddenError, ValidationError
from src.core.pagination import parse_uuid

#: The three states, in the order they widen.
SCOPES = frozenset({"PRIVATE", "SHARED", "PUBLIC"})

#: What a share row grants. Never anything else: a share that could grant edit
#: would make "only the owner writes" a claim rather than a property.
VIEW = "VIEW"

#: An audience larger than this is what `PUBLIC` is for.
MAX_MEMBERS = 100


def visibility(model, resource_type: str, principal):
    """The predicate that decides whether this reader may see a row.

    One statement, three ways in. Returned as a predicate rather than a query
    so a caller can add its own filters, ordering and paging to it.
    """
    return or_(
        model.owner_id == principal.user_id,
        model.scope == "PUBLIC",
        cast(model.id, String).in_(_shared_ids(resource_type, principal)),
    )


def _shared_ids(resource_type: str, principal):
    from src.models.personal import ResourceShare

    return select(ResourceShare.resource_id).where(
        ResourceShare.user_id == principal.user_id,
        ResourceShare.resource_type == resource_type,
        ResourceShare.permission == VIEW,
    )


def require_owner(row: Any, principal, *, kind: str) -> None:
    """Refuse a write by anybody but the owner, in the same words everywhere."""
    if row.owner_id != principal.user_id:
        raise ForbiddenError(
            f"Only the owner may change this {kind}.",
            details={"owner_id": str(row.owner_id), "id": str(row.id)},
        )


def scope_of(value: Any, *, current: str = "PRIVATE", principal=None,
             share_permission: str = "") -> str:
    """Validate a requested visibility, and who is allowed to request it.

    Sharing is its own permission because "I keep my own" and "I decide what
    other people see" are different privileges — and the refusal has to arrive
    in the form rather than as a 403 after somebody has typed a name.
    """
    scope = str(value or current).strip().upper()
    if scope not in SCOPES:
        raise ValidationError(
            "Unknown visibility.", details={"scope": scope, "allowed": sorted(SCOPES)},
        )
    if scope != "PRIVATE" and share_permission and principal is not None:
        principal.require(share_permission)
    return scope


def member_ids(session, resource_type: str, resource_id: Any) -> list[UUID]:
    from src.models.personal import ResourceShare

    return list(session.scalars(
        select(ResourceShare.user_id).where(
            ResourceShare.resource_type == resource_type,
            ResourceShare.resource_id == str(resource_id),
        )
    ).all())


def members(session, resource_type: str, resource_id: Any) -> list[dict[str, str]]:
    """The audience, as people rather than ids — what a form renders."""
    from src.models.identity import User
    from src.models.personal import ResourceShare

    rows = session.execute(
        select(User.id, User.full_name, User.email)
        .join(ResourceShare, ResourceShare.user_id == User.id)
        .where(
            ResourceShare.resource_type == resource_type,
            ResourceShare.resource_id == str(resource_id),
        )
        .order_by(User.full_name)
    ).all()
    return [{"id": str(user_id), "name": name, "email": email} for user_id, name, email in rows]


def replace_members(
    session,
    resource_type: str,
    resource_id: Any,
    wanted: list[str],
    *,
    principal,
    owner_id: Any,
) -> None:
    """Set the explicit audience, replacing whatever was there.

    Replacement rather than merge, because the UI edits the whole list: a
    member removed on screen has to disappear here, and an "add" endpoint that
    cannot remove leaves an audience nobody can shrink.
    """
    from src.models.identity import User
    from src.models.personal import ResourceShare

    identifiers = [parse_uuid(value, field="member_id") for value in wanted]
    # The owner already sees it; a share row for them would be a second answer
    # to the same question, and `can_edit` would then depend on which one won.
    identifiers = [value for value in dict.fromkeys(identifiers) if value != owner_id]
    present = set(session.scalars(
        select(User.id).where(
            User.id.in_(identifiers), User.deleted_at.is_(None), User.status == "ACTIVE"
        )
    ).all()) if identifiers else set()
    missing = set(identifiers) - present
    if missing:
        raise ValidationError(
            "One or more shared members do not exist.",
            details={"member_ids": sorted(map(str, missing))},
        )

    session.execute(delete(ResourceShare).where(
        ResourceShare.resource_type == resource_type,
        ResourceShare.resource_id == str(resource_id),
    ))
    for user_id in identifiers:
        session.add(ResourceShare(
            resource_type=resource_type,
            resource_id=str(resource_id),
            user_id=user_id,
            shared_by_id=principal.user_id,
            permission=VIEW,
        ))


def requested_members(payload: dict[str, Any]) -> list[str]:
    """The member list a payload asked for, capped and de-duplicated."""
    raw = payload.get("member_ids") or []
    if not isinstance(raw, (list, tuple)):
        raise ValidationError("member_ids must be an array of user ids.")
    return list(dict.fromkeys(str(value) for value in raw))[:MAX_MEMBERS]
