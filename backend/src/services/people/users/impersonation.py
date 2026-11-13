"""Who may impersonate whom."""

from __future__ import annotations

from sqlalchemy import select

IMPERSONATE_PERMISSION = "users.impersonate"


def _may_impersonate(session, principal, user) -> tuple[bool, str]:
    """Whether `principal` may act as `user`, and why not when they may not.

    The rank check is the one that matters. Acting as somebody with *more*
    access than you have is privilege escalation wearing a costume: it would
    let a manager reach the administration area through a feature built for
    support. Ranks come from the same `roles` table the permission matrix
    edits, so raising a role's rank raises who may not be impersonated.
    """
    if not principal.can(IMPERSONATE_PERMISSION):
        return False, "You do not have permission to impersonate."
    if user.id == principal.user_id:
        return False, "You are already signed in as yourself."
    if user.status != "ACTIVE":
        return False, f"That account is {user.status.lower()}."

    own_rank = _role_rank(session, principal.role_code)
    target_rank = user.role.rank if user.role else 0
    if own_rank is not None and target_rank > own_rank:
        return False, "You cannot act as somebody with more access than you have."
    return True, ""


def _role_rank(session, code: str | None) -> int | None:
    """The rank of a role, or None when it is not in the table."""
    if not code:
        return None
    from src.models.identity import Role

    row = session.scalars(select(Role).where(Role.code == code)).first()
    return row.rank if row else None
