"""Leaving, members, search and presence."""

from __future__ import annotations

from typing import Any

from sqlalchemy import String, and_, cast, or_, select

from src.core.clock import iso
from src.core.errors import ForbiddenError, ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import found_or_404
from src.services.collaboration.chat.access import (
    RESOURCE,
    USE,
    _channel,
    _member,
    _users,
    authorise_read,
)
from src.services.collaboration.chat.channel_admin import (
    _changed,
    _may_manage,
    detail,
)


def leave(session, channel_id: Any, *, principal) -> dict[str, Any]:
    authorise_read(session, channel_id, principal)
    row = _channel(session, channel_id)
    if row.kind == "DIRECT":
        raise ValidationError("A direct conversation cannot be left.")
    membership = _member(row, principal.user_id)
    if membership is not None:
        row.members.remove(membership)
        session.flush()
    _changed(session, row, also=[str(principal.user_id)])
    return {"left": True, "id": str(row.id)}


def add_members(session, channel_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.collab import ChatMember

    authorise_read(session, channel_id, principal)
    row = _channel(session, channel_id)
    if row.kind == "DIRECT":
        raise ValidationError("A direct conversation is between two people.")
    if _member(row, principal.user_id) is None and not principal.is_admin:
        raise ForbiddenError("Only members can add people to this channel.")
    present = {member.user_id for member in row.members}
    for user_id in _users(session, (payload or {}).get("member_ids")):
        if user_id not in present:
            row.members.append(ChatMember(user_id=user_id, role="MEMBER"))
    session.flush()
    _changed(session, row)
    return detail(session, channel_id, principal=principal)


def remove_member(session, channel_id: Any, user_id: Any, *, principal) -> dict[str, Any]:
    authorise_read(session, channel_id, principal)
    row = _channel(session, channel_id)
    if not _may_manage(row, principal):
        raise ForbiddenError("Only the channel's owner can remove people.")
    target = parse_uuid(user_id, field="user_id")
    membership = found_or_404(_member(row, target), "That person is not in this channel.")
    row.members.remove(membership)
    session.flush()
    _changed(session, row, also=[str(target)])
    return detail(session, channel_id, principal=principal)


def search(session, args, *, principal) -> dict[str, Any]:
    """Messages matching a phrase, in every conversation this person may read."""
    from src.models.collab import ChatChannel, ChatMember
    from src.models.content import Comment
    from src.models.identity import User

    principal.require(USE)
    term = str(args.get("q") or "").strip()
    if len(term) < 2:
        return {"items": [], "total": 0, "q": term}
    readable = select(cast(ChatChannel.id, String)).where(
        or_(
            ChatChannel.id.in_(select(ChatMember.channel_id).where(ChatMember.user_id == principal.user_id)),
            and_(ChatChannel.kind == "CHANNEL", ChatChannel.visibility == "PUBLIC"),
        )
    )
    clauses = [
        Comment.resource_type == RESOURCE,
        Comment.resource_id.in_(readable),
        Comment.deleted_at.is_(None),
        Comment.body.ilike(f"%{term}%"),
    ]
    channel_filter = args.get("channel_id")
    if channel_filter:
        clauses.append(Comment.resource_id == str(parse_uuid(channel_filter, field="channel_id")))
    rows = session.execute(
        select(Comment, ChatChannel, User.full_name)
        .join(ChatChannel, cast(ChatChannel.id, String) == Comment.resource_id)
        .outerjoin(User, User.id == Comment.author_id)
        .where(*clauses)
        .order_by(Comment.created_at.desc())
        .limit(50)
    ).all()
    return {
        "items": [
            {
                "id": str(comment.id),
                "channel_id": str(channel.id),
                "channel_name": channel.name if channel.kind == "CHANNEL" else "Direct message",
                "channel_kind": channel.kind,
                "parent_id": str(comment.parent_id) if comment.parent_id else None,
                "body": comment.body,
                "author": name or "Former user",
                "created_at": iso(comment.created_at),
            }
            for comment, channel, name in rows
        ],
        "total": len(rows),
        "q": term,
    }


def presence(session, args, *, principal) -> dict[str, Any]:
    """Everybody's status, or the named people's — for the dots."""
    from src.services.collaboration import presence as roster

    principal.require(USE)
    raw = str(args.get("ids") or "").strip()
    if raw:
        return {"statuses": roster.status_of([item for item in raw.split(",") if item])}
    return {"statuses": roster.everyone()}


def set_presence(payload: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.services.collaboration import presence as roster

    return roster.set_status(principal.user_id, (payload or {}).get("status"))
