"""Kinds of approval (providers), references, and who decides."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from sqlalchemy import func, or_, select

from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.core.naming import identifier, sequence_of
from src.models.approvals import ApprovalRequest

REFERENCE_PREFIX = "APR"


STATUSES = ("PENDING", "APPROVED", "REJECTED", "WITHDRAWN")


DECISIONS = {"approve": "APPROVED", "reject": "REJECTED"}


#: How many requests one bulk decision may carry.
MAX_BULK = 100


@dataclass
class Provider:
    """What one kind of approval means.

    `apply` is called inside the deciding transaction with the request and
    whether it was approved; raising from it aborts the decision, so a change
    that can no longer be applied is reported rather than recorded as done.
    """

    kind: str
    label: str
    icon: str
    decide_permission: str
    #: How long an answer may take before the inbox calls it late.
    sla_hours: int = 48
    apply: Callable[..., None] | None = None
    #: Extra facts for the detail drawer.
    describe: Callable[..., dict[str, Any]] | None = None
    #: Whether a comment is required to reject.
    reject_needs_comment: bool = True
    extra: dict[str, Any] = field(default_factory=dict)


_PROVIDERS: dict[str, Provider] = {}


def register(provider: Provider) -> Provider:
    """Make a kind of approval known. Idempotent: the last registration wins."""
    _PROVIDERS[provider.kind] = provider
    return provider


def providers() -> dict[str, Provider]:
    """Every registered provider. The built-in ones register when their modules
    are imported by the composition root (`src/services/wiring.py`)."""
    return _PROVIDERS


def provider_for(kind: str) -> Provider:
    found = providers().get(kind)
    if found is None:
        raise ValidationError(
            f"{kind!r} is not a kind of approval.", details={"available": sorted(providers())}
        )
    return found


def _reference(session) -> str:
    latest = session.scalar(
        select(func.max(ApprovalRequest.reference)).where(
            ApprovalRequest.reference.like(f"{REFERENCE_PREFIX}-%")
        )
    )
    number = sequence_of(latest, prefix=REFERENCE_PREFIX) + 1
    candidate = identifier(REFERENCE_PREFIX, number, width=5)
    while session.scalar(select(ApprovalRequest.id).where(ApprovalRequest.reference == candidate)):
        number += 1
        candidate = identifier(REFERENCE_PREFIX, number, width=5)
    return candidate


def _event(action: str, *, actor_id: Any = None, actor_label: str = "", comment: str = "",
           at=None) -> dict[str, Any]:
    return {
        "at": iso(at or now()),
        "action": action,
        "actor_id": str(actor_id) if actor_id else None,
        "actor_label": actor_label,
        "comment": comment or "",
    }


def deciders(session, permission: str, *, limit: int = 12) -> list[Any]:
    """People who may decide a request needing `permission`, through role or group."""
    from src.models.identity import Group, Role, User, user_groups

    by_role = (
        select(User.id)
        .join(Role, User.role_id == Role.id)
        .where(Role.permissions.any(permission))
    )
    by_group = (
        select(user_groups.c.user_id)
        .join(Group, Group.id == user_groups.c.group_id)
        .where(Group.permissions.any(permission), Group.deleted_at.is_(None))
    )
    return list(
        session.scalars(
            select(User)
            .where(
                or_(User.id.in_(by_role), User.id.in_(by_group)),
                User.deleted_at.is_(None),
                User.status == "ACTIVE",
            )
            .order_by(User.last_login_at.desc().nullslast(), User.full_name)
            .limit(limit)
        ).unique()
    )
