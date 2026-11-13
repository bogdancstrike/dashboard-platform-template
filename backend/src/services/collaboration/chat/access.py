"""Channels, membership, and who may read or write."""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from sqlalchemy import func, select

from src.core.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
)
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404

RESOURCE = "chat_channel"


USE = "chat.use"


VISIBILITIES = ("PUBLIC", "PRIVATE")


MAX_NAME = 80


MAX_TOPIC = 240


_NAME = re.compile(r"[^a-z0-9\-_]+")


def _channel(session, channel_id: Any):
    from src.models.collab import ChatChannel

    row = get_or_404(
        session,
        ChatChannel,
        parse_uuid(channel_id, field="channel_id"),
        "That conversation does not exist.",
    )
    return row


def _member(row, user_id) -> Any | None:
    return next((member for member in row.members if member.user_id == user_id), None)


def authorise_read(session, channel_id: Any, principal) -> None:
    principal.require(USE)
    row = _channel(session, channel_id)
    if row.visibility == "PUBLIC" and row.kind == "CHANNEL":
        return
    if _member(row, principal.user_id) is None:
        raise NotFoundError("That conversation does not exist.")


def authorise_write(session, channel_id: Any, principal) -> None:
    from src.models.collab import ChatMember

    row = _channel(session, channel_id)
    if row.archived_at is not None:
        raise ConflictError("This channel is archived; nothing more can be said in it.")
    if _member(row, principal.user_id) is not None:
        return
    if row.visibility == "PUBLIC" and row.kind == "CHANNEL":
        row.members.append(ChatMember(user_id=principal.user_id, role="MEMBER"))
        session.flush()
        return
    raise ForbiddenError("Only members can write in this conversation.")


def label(session, channel_id: Any) -> str:
    from src.models.collab import ChatChannel

    row = session.get(ChatChannel, channel_id)
    if row is None:
        return str(channel_id)
    return row.name if row.kind == "CHANNEL" else "a direct message"


def audience(session, channel_id: Any) -> list[str]:
    from src.models.collab import ChatMember

    return [
        str(user_id)
        for user_id in session.scalars(
            select(ChatMember.user_id).where(ChatMember.channel_id == channel_id)
        ).all()
    ]


def _slug(raw: Any) -> str:
    name = _NAME.sub("-", str(raw or "").strip().lower().lstrip("#")).strip("-")
    name = re.sub(r"-{2,}", "-", name)
    if not name:
        raise ValidationError("A channel needs a name.", details={"field": "name"})
    if len(name) > MAX_NAME:
        raise ValidationError(f"A channel name is at most {MAX_NAME} characters.", details={"field": "name"})
    return name


def _topic(raw: Any) -> str | None:
    topic = str(raw or "").strip()
    if len(topic) > MAX_TOPIC:
        raise ValidationError(f"A topic is at most {MAX_TOPIC} characters.", details={"field": "topic"})
    return topic or None


def _users(session, raw: Any) -> list[UUID]:
    from src.models.identity import User

    if raw in (None, ""):
        return []
    if not isinstance(raw, list):
        raise ValidationError("member_ids must be a list.", details={"field": "member_ids"})
    ids = {parse_uuid(item, field="member_ids") for item in raw}
    found = set(
        session.scalars(
            select(User.id).where(User.id.in_(ids), User.deleted_at.is_(None))
        ).all()
    )
    missing = [str(item) for item in ids - found]
    if missing:
        raise NotFoundError("Somebody to add does not exist.", details={"member_ids": missing})
    return sorted(found, key=str)


def _taken(session, name: str, *, except_id=None) -> bool:
    from src.models.collab import ChatChannel

    clauses = [ChatChannel.kind == "CHANNEL", ChatChannel.archived_at.is_(None),
               func.lower(ChatChannel.name) == name]
    if except_id is not None:
        clauses.append(ChatChannel.id != except_id)
    return session.scalar(select(func.count()).select_from(ChatChannel).where(*clauses)) > 0
