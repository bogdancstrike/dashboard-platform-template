"""Team chat: channels, direct messages, unread counts and search (§47).

A channel's *messages* are comments (`services/comments.py`, resource type
`chat_channel`) — mentions, replies, reactions, attachments, edit and delete
are the record thread's rules, written once. What lives here is the room:

* **Who may read.** A public channel is readable by anybody with `chat.use`;
  a private channel or a direct conversation by its members only. A channel
  somebody may not read is *not found*, never "forbidden": saying a private
  room exists is itself a disclosure.
* **Who may write.** Members. Posting in a public channel one has not joined
  joins it, which is what people expect from every chat tool they have used.
* **What is unread.** Lines by other people after the reader's marker
  (`thread_reads`), or after they joined when they have never opened it.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from sqlalchemy import String, and_, cast, func, or_, select

from src.core.clock import iso, now
from src.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid

RESOURCE = "chat_channel"
USE = "chat.use"

VISIBILITIES = ("PUBLIC", "PRIVATE")
MAX_NAME = 80
MAX_TOPIC = 240

_NAME = re.compile(r"[^a-z0-9\-_]+")


# ── the room's rules, used by comments.py ────────────────────────────────


def _channel(session, channel_id: Any):
    from src.models.collab import ChatChannel

    row = session.get(ChatChannel, parse_uuid(channel_id, field="channel_id"))
    if row is None:
        raise NotFoundError("That conversation does not exist.")
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


# ── listing ──────────────────────────────────────────────────────────────


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


def detail(session, channel_id: Any, *, principal) -> dict[str, Any]:
    authorise_read(session, channel_id, principal)
    row = _channel(session, channel_id)
    me = principal.user_id
    membership = _member(row, me)
    unread = _unread(session, me, [row.id]).get(str(row.id), (0, 0))
    summary = _summary(row, principal, unread, None)
    return {
        **summary,
        "members": _people(row, me),
        "created_at": iso(row.created_at),
        "can_manage": _may_manage(row, principal),
        "can_post": principal.can(USE) and row.archived_at is None
        and (membership is not None or row.visibility == "PUBLIC"),
    }


# ── writing ──────────────────────────────────────────────────────────────


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


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.collab import ChatChannel, ChatMember

    principal.require(USE)
    if not isinstance(payload, dict):
        raise ValidationError("The channel must be a JSON object.")
    name = _slug(payload.get("name"))
    if _taken(session, name):
        raise ConflictError(f"There is already a channel called #{name}.", details={"field": "name"})
    visibility = str(payload.get("visibility") or "PUBLIC").upper()
    if visibility not in VISIBILITIES:
        raise ValidationError("visibility must be PUBLIC or PRIVATE.", details={"field": "visibility"})

    row = ChatChannel(
        name=name, topic=_topic(payload.get("topic")), kind="CHANNEL", visibility=visibility,
        created_by_id=principal.user_id, organization_id=principal.organization_id,
    )
    row.members.append(ChatMember(user_id=principal.user_id, role="OWNER"))
    for user_id in _users(session, payload.get("member_ids")):
        if user_id != principal.user_id:
            row.members.append(ChatMember(user_id=user_id, role="MEMBER"))
    session.add(row)
    session.flush()
    _changed(session, row)
    return detail(session, row.id, principal=principal)


def direct(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """The conversation with one other person — found if it exists, else begun."""
    from src.models.collab import ChatChannel, ChatMember

    principal.require(USE)
    people = _users(session, [(payload or {}).get("user_id")])
    other = people[0]
    pair = sorted({str(other), str(principal.user_id)})
    key = ":".join(pair)
    row = session.scalars(select(ChatChannel).where(ChatChannel.direct_key == key)).one_or_none()
    if row is None:
        row = ChatChannel(name="direct", kind="DIRECT", visibility="PRIVATE", direct_key=key,
                          created_by_id=principal.user_id)
        for person in pair:
            row.members.append(ChatMember(user_id=UUID(person), role="MEMBER"))
        session.add(row)
        session.flush()
    return detail(session, row.id, principal=principal)


def _may_manage(row, principal) -> bool:
    if row.kind == "DIRECT":
        return False
    membership = _member(row, principal.user_id)
    return principal.is_admin or (membership is not None and membership.role == "OWNER")


def update(session, channel_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    authorise_read(session, channel_id, principal)
    row = _channel(session, channel_id)
    if not _may_manage(row, principal):
        raise ForbiddenError("Only the channel's owner can change it.")
    payload = payload or {}
    if "name" in payload:
        name = _slug(payload.get("name"))
        if _taken(session, name, except_id=row.id):
            raise ConflictError(f"There is already a channel called #{name}.", details={"field": "name"})
        row.name = name
    if "topic" in payload:
        row.topic = _topic(payload.get("topic"))
    if "muted" in payload:
        membership = _member(row, principal.user_id)
        if membership is not None:
            membership.muted = bool(payload.get("muted"))
    session.flush()
    _changed(session, row)
    return detail(session, row.id, principal=principal)


def archive(session, channel_id: Any, *, principal) -> dict[str, Any]:
    authorise_read(session, channel_id, principal)
    row = _channel(session, channel_id)
    if not _may_manage(row, principal):
        raise ForbiddenError("Only the channel's owner can archive it.")
    row.archived_at = now()
    session.flush()
    _changed(session, row)
    return {"archived": True, "id": str(row.id)}


def join(session, channel_id: Any, *, principal) -> dict[str, Any]:
    authorise_read(session, channel_id, principal)
    authorise_write(session, channel_id, principal)
    row = _channel(session, channel_id)
    _changed(session, row)
    return detail(session, channel_id, principal=principal)


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
    membership = _member(row, target)
    if membership is None:
        raise NotFoundError("That person is not in this channel.")
    row.members.remove(membership)
    session.flush()
    _changed(session, row, also=[str(target)])
    return detail(session, channel_id, principal=principal)


def _changed(session, row, also: list[str] | None = None) -> None:
    """Tell the members the room itself changed: its name, its people."""
    from src.services import live

    payload = {"type": "chat.channel", "channel_id": str(row.id)}
    try:
        if row.visibility == "PUBLIC" and row.kind == "CHANNEL":
            live.publish_to_all(payload)
            return
        for person in {*audience(session, row.id), *(also or [])}:
            live.publish_to_user(person, payload)
    except Exception:  # pragma: no cover - best-effort by contract
        pass


# ── search ───────────────────────────────────────────────────────────────


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
    from src.services import presence as roster

    principal.require(USE)
    raw = str(args.get("ids") or "").strip()
    if raw:
        return {"statuses": roster.status_of([item for item in raw.split(",") if item])}
    return {"statuses": roster.everyone()}


def set_presence(payload: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.services import presence as roster

    return roster.set_status(principal.user_id, (payload or {}).get("status"))
