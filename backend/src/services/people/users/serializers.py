"""A user as the API returns them: summary, sessions, sign-ins."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core.clock import iso
from src.core.errors import NotFoundError
from src.core.naming import initials
from src.core.pagination import parse_uuid

#: Sessions and sign-ins shown on the detail page. It is a profile, not a log.
RECENT = 8


def summarise(user) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "email": user.email,
        "username": user.username,
        "full_name": user.full_name,
        "initials": initials(user.full_name),
        "avatar_url": user.avatar_url,
        "job_title": user.job_title or "",
        "status": user.status,
        "role_code": user.role.code if user.role else None,
        "role_name": user.role.name if user.role else "",
        "role_color": user.role.color if user.role else "",
        "mfa_enabled": bool(user.mfa_enabled),
        "last_login_at": iso(user.last_login_at),
        "login_count": user.login_count,
        "group_names": sorted(group.name for group in user.groups),
        "created_at": iso(user.created_at),
        "updated_at": iso(user.updated_at),
    }


def load_person(session, user_id: Any):
    """One person by id, with their groups, or a 404.

    Public because `/profile` (§40) needs the same row and the same refusal.
    A second loader would be a second answer to "does this person exist", and
    the two would eventually disagree about a soft-deleted account.
    """
    return _load(session, user_id)


def _load(session, user_id: Any):
    from src.models.identity import User

    identifier = parse_uuid(user_id, field="user_id")
    user = session.scalars(
        select(User)
        .options(selectinload(User.groups))
        .where(User.id == identifier, User.deleted_at.is_(None))
    ).unique().first()
    if user is None:
        raise NotFoundError("That user does not exist.", details={"id": str(identifier)})
    return user


def _sessions(session, user) -> list[dict[str, Any]]:
    from src.models.identity import UserSession

    rows = session.scalars(
        select(UserSession)
        .where(UserSession.user_id == user.id)
        .order_by(UserSession.last_seen_at.desc().nullslast())
        .limit(RECENT)
    ).all()
    return [
        {
            "id": str(row.id),
            "device": row.device or "",
            "ip_address": row.ip_address or "",
            "location": row.location or "",
            "last_seen_at": iso(row.last_seen_at),
            "revoked": row.revoked_at is not None,
            "trusted": bool(row.trusted),
        }
        for row in rows
    ]


def _sign_ins(session, user) -> list[dict[str, Any]]:
    from src.models.identity import LoginEvent

    rows = session.scalars(
        select(LoginEvent)
        .where(LoginEvent.user_id == user.id)
        .order_by(LoginEvent.created_at.desc())
        .limit(RECENT)
    ).all()
    return [
        {
            "id": str(row.id),
            "result": row.result,
            "reason": row.reason or "",
            "ip_address": row.ip_address or "",
            "location": row.location or "",
            "device": row.device or "",
            "method": row.method,
            "at": iso(row.created_at),
        }
        for row in rows
    ]


def _named(row) -> dict[str, Any] | None:
    if row is None:
        return None
    return {"id": str(row.id), "name": getattr(row, "name", None) or getattr(row, "full_name", "")}


def _state(user) -> dict[str, Any]:
    return {
        "status": user.status,
        "role": user.role.code if user.role else None,
        "groups": sorted(group.name for group in user.groups),
    }
