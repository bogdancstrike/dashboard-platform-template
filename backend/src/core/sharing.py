"""One sharing model, for everything a person can save (§5, §28, §45, §46).

Rationale: docs/architecture/backend/modules/core-sharing.md
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


#: `session.info` key of the audiences `prefetch_members` loaded for a list.
_PREFETCHED = "nucleus.sharing.members"


def prefetch_members(session, resource_type: str, resource_ids) -> None:
    """Load the audience of a whole page of rows in one query.

    A list endpoint serialises each row with `members()`, which was one query
    per row: 18 for the seeded saved-searches drawer, one per report and per
    dashboard (docs/testing/performance.md). Calling this first makes each of
    those `members()` calls a dictionary lookup for the rest of the session.
    """
    from src.models.identity import User
    from src.models.personal import ResourceShare

    keys = [str(value) for value in dict.fromkeys(resource_ids)]
    if not keys:
        return
    found: dict[str, list[dict[str, str]]] = {key: [] for key in keys}
    rows = session.execute(
        select(ResourceShare.resource_id, User.id, User.full_name, User.email)
        .join(User, ResourceShare.user_id == User.id)
        .where(ResourceShare.resource_type == resource_type, ResourceShare.resource_id.in_(keys))
        .order_by(User.full_name)
    ).all()
    for resource_id, user_id, name, email in rows:
        found[resource_id].append({"id": str(user_id), "name": name, "email": email})
    cache = session.info.setdefault(_PREFETCHED, {})
    for key, audience in found.items():
        cache[(resource_type, key)] = audience


def members(session, resource_type: str, resource_id: Any) -> list[dict[str, str]]:
    """The audience, as people rather than ids — what a form renders."""
    from src.models.identity import User
    from src.models.personal import ResourceShare

    prefetched = session.info.get(_PREFETCHED, {}).get((resource_type, str(resource_id)))
    if prefetched is not None:
        return [dict(member) for member in prefetched]

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

    session.info.get(_PREFETCHED, {}).pop((resource_type, str(resource_id)), None)
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
