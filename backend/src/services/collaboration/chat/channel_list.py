"""The channel list, unread counts and the chat badge."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import String, and_, cast, func, or_, select

from src.core.clock import iso
from src.services.collaboration import notifications
from src.services.collaboration.chat.access import RESOURCE, USE, _member


def channels(session, args, *, principal) -> dict[str, Any]:
    """Every conversation this person is in, and the public ones they could join."""
    from src.models.collab import ChatChannel, ChatMember

    principal.require(USE)
    me = principal.user_id
    mine = select(ChatMember.channel_id).where(ChatMember.user_id == me)
    rows = session.scalars(
        select(ChatChannel)
        .where(
            ChatChannel.archived_at.is_(None),
            or_(
                ChatChannel.id.in_(mine),
                and_(ChatChannel.kind == "CHANNEL", ChatChannel.visibility == "PUBLIC"),
            ),
        )
        .order_by(func.coalesce(ChatChannel.last_message_at, ChatChannel.created_at).desc())
    ).all()

    ids = [row.id for row in rows]
    unread = _unread(session, me, ids)
    last = _last_lines(session, ids)

    items = [_summary(row, principal, unread.get(str(row.id), (0, 0)), last.get(str(row.id)))
             for row in rows]
    return {
        "items": items,
        "unread_total": sum(item["unread"] for item in items if item["is_member"]),
        "mention_total": sum(item["mentions"] for item in items if item["is_member"]),
        "can_create": principal.can(USE),
    }


@notifications.badges.connect
def _unread_badge(session, user_id: UUID) -> dict[str, int]:
    """The Chat menu item's badge on the notification poll; 0 without the chat tables."""
    try:
        with session.begin_nested():
            return {"chat_unread": unread_total(session, user_id)}
    except Exception:  # pragma: no cover - a database without the chat tables
        return {"chat_unread": 0}


def unread_total(session, user_id: UUID) -> int:
    """The number the Chat menu item carries."""
    from src.models.collab import ChatChannel, ChatMember

    ids = list(
        session.scalars(
            select(ChatChannel.id)
            .join(ChatMember, ChatMember.channel_id == ChatChannel.id)
            .where(ChatMember.user_id == user_id, ChatChannel.archived_at.is_(None))
        ).all()
    )
    return sum(count for count, _ in _unread(session, user_id, ids).values())


def _unread(session, user_id: UUID, ids: list[Any]) -> dict[str, tuple[int, int]]:
    """channel id → (unread lines, unread lines that mention the reader)."""
    from src.models.collab import ChatMember, ThreadRead
    from src.models.content import Comment

    if not ids:
        return {}
    since = func.coalesce(ThreadRead.last_read_at, ChatMember.created_at)
    rows = session.execute(
        select(
            Comment.resource_id,
            func.count(),
            func.count().filter(Comment.mentions.any(str(user_id))),
        )
        .join(
            ChatMember,
            and_(cast(ChatMember.channel_id, String) == Comment.resource_id, ChatMember.user_id == user_id),
        )
        .outerjoin(
            ThreadRead,
            and_(
                ThreadRead.user_id == user_id,
                ThreadRead.resource_type == RESOURCE,
                ThreadRead.resource_id == Comment.resource_id,
            ),
        )
        .where(
            Comment.resource_type == RESOURCE,
            Comment.resource_id.in_([str(item) for item in ids]),
            Comment.deleted_at.is_(None),
            Comment.author_id != user_id,
            Comment.created_at > since,
        )
        .group_by(Comment.resource_id)
    ).all()
    return {resource_id: (int(count), int(mentions)) for resource_id, count, mentions in rows}


def _last_lines(session, ids: list[Any]) -> dict[str, dict[str, Any]]:
    from src.models.content import Comment
    from src.models.identity import User

    if not ids:
        return {}
    rows = session.execute(
        select(Comment.resource_id, Comment.body, Comment.created_at, User.full_name, Comment.attachments)
        .outerjoin(User, User.id == Comment.author_id)
        .where(
            Comment.resource_type == RESOURCE,
            Comment.resource_id.in_([str(item) for item in ids]),
            Comment.deleted_at.is_(None),
        )
        .distinct(Comment.resource_id)
        .order_by(Comment.resource_id, Comment.created_at.desc())
    ).all()
    return {
        resource_id: {
            "body": (body or (f"📎 {attachments[0].get('name')}" if attachments else ""))[:140],
            "author": name or "Former user",
            "at": iso(at),
        }
        for resource_id, body, at, name, attachments in rows
    }


def _people(row, viewer_id) -> list[dict[str, Any]]:
    return [
        {
            "id": str(member.user_id),
            "name": member.user.full_name if member.user else "Former user",
            "avatar_url": member.user.avatar_url if member.user else None,
            "job_title": member.user.job_title if member.user else None,
            "role": member.role,
            "is_me": member.user_id == viewer_id,
        }
        for member in sorted(row.members, key=lambda item: (item.role != "OWNER", item.created_at))
    ]


def _summary(row, principal, unread: tuple[int, int], last: dict[str, Any] | None) -> dict[str, Any]:
    me = principal.user_id
    membership = _member(row, me)
    other = None
    if row.kind == "DIRECT":
        other = next(
            (person for person in _people(row, me) if not person["is_me"]),
            None,
        )
    return {
        "id": str(row.id),
        "name": other["name"] if other else row.name,
        "topic": row.topic,
        "kind": row.kind,
        "visibility": row.visibility,
        "is_member": membership is not None,
        "member_count": len(row.members),
        "other": other,
        "unread": unread[0] if membership else 0,
        "mentions": unread[1] if membership else 0,
        "muted": bool(membership.muted) if membership else False,
        "last_message": last,
        "last_message_at": iso(row.last_message_at),
        "archived": row.archived_at is not None,
    }
