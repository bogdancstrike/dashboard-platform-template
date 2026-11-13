"""Seed data for collab: seed_chat, seed_threads."""

from __future__ import annotations

import random
from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select

from src.core.clock import now
from src.seed.collab.script import (
    ADMIN_READ_MINUTES_AGO,
    CHANNELS,
    DIRECTS,
    SCRIPTS,
    _comment,
    _who,
)


def seed_chat(session, personas, others) -> dict[str, int]:
    from src.models.collab import ChatChannel, ChatMember, ThreadRead

    moment = now()
    added = {"channels": 0, "messages": 0}
    for name, topic, visibility, extra in CHANNELS:
        exists = session.scalar(
            select(func.count()).select_from(ChatChannel)
            .where(ChatChannel.kind == "CHANNEL", func.lower(ChatChannel.name) == name)
        )
        if exists:
            continue
        members = list(personas.values()) if visibility == "PUBLIC" else [
            personas[key] for key in ("admin", "manager") if key in personas
        ]
        members += others[:extra]
        script = SCRIPTS.get(name, [])
        oldest = max((entry[0] for entry in script), default=60) + 60 * 24
        channel = ChatChannel(
            name=name, topic=topic, kind="CHANNEL", visibility=visibility,
            created_by_id=personas["admin"].id if "admin" in personas else None,
            created_at=moment - timedelta(minutes=oldest),
        )
        seen: set[UUID] = set()
        for index, person in enumerate(members):
            if person.id in seen:
                continue
            seen.add(person.id)
            channel.members.append(ChatMember(
                user_id=person.id, role="OWNER" if index == 0 else "MEMBER",
                created_at=moment - timedelta(minutes=oldest),
            ))
        session.add(channel)
        session.flush()
        added["channels"] += 1

        last = None
        for minutes, author, body, reactions, replies in script:
            at = moment - timedelta(minutes=minutes)
            reacted = {
                emoji: [str(_who(key, personas, others).id) for key in keys]
                for emoji, keys in reactions.items()
            }
            parent = _comment(session, channel_id=str(channel.id), author=_who(author, personas, others),
                              body=body, at=at, reactions=reacted)
            added["messages"] += 1
            last = at
            for reply_minutes, reply_author, reply_body in replies:
                _comment(session, channel_id=str(channel.id), author=_who(reply_author, personas, others),
                         body=reply_body, at=moment - timedelta(minutes=reply_minutes), parent_id=parent.id)
                added["messages"] += 1
        channel.last_message_at = last

        # Read markers: everybody but the admin persona has read everything;
        # the admin has a little waiting, so the badge has something to say.
        for person_id in seen:
            read_at = moment
            if "admin" in personas and person_id == personas["admin"].id:
                read_at = moment - timedelta(minutes=ADMIN_READ_MINUTES_AGO.get(name, 0))
            session.add(ThreadRead(user_id=person_id, resource_type="chat_channel",
                                   resource_id=str(channel.id), last_read_at=read_at))

    for first, second, lines in DIRECTS:
        if first not in personas or second not in personas:
            continue
        pair = sorted({str(personas[first].id), str(personas[second].id)})
        key = ":".join(pair)
        if session.scalar(select(func.count()).select_from(ChatChannel).where(ChatChannel.direct_key == key)):
            continue
        oldest = max(entry[0] for entry in lines) + 60
        channel = ChatChannel(name="direct", kind="DIRECT", visibility="PRIVATE", direct_key=key,
                              created_by_id=personas[first].id, created_at=moment - timedelta(minutes=oldest))
        for person in pair:
            channel.members.append(ChatMember(user_id=UUID(person), role="MEMBER",
                                              created_at=moment - timedelta(minutes=oldest)))
        session.add(channel)
        session.flush()
        added["channels"] += 1
        for minutes, author, body in lines:
            _comment(session, channel_id=str(channel.id), author=personas[author], body=body,
                     at=moment - timedelta(minutes=minutes))
            added["messages"] += 1
        channel.last_message_at = moment - timedelta(minutes=min(entry[0] for entry in lines))
        # The other person has read it; the admin has the newest line waiting.
        for person in (first, second):
            read = moment if person != "admin" else moment - timedelta(minutes=min(e[0] for e in lines) + 1)
            session.add(ThreadRead(user_id=personas[person].id, resource_type="chat_channel",
                                   resource_id=str(channel.id), last_read_at=read))
    session.flush()
    return added


def seed_threads(session, personas) -> int:
    """Reactions on seeded record conversations, so a thread looks lived in."""
    from src.models.content import Comment

    rng = random.Random(4711)
    people = [str(person.id) for person in personas.values()]
    if not people:
        return 0
    already = session.scalar(
        select(func.count()).select_from(Comment)
        .where(Comment.resource_type.in_(("ticket", "task", "project", "customer")),
               func.jsonb_typeof(Comment.reactions) == "object")
    )
    if already:
        return 0
    rows = session.scalars(
        select(Comment)
        .where(Comment.resource_type.in_(("ticket", "task", "project", "customer")),
               Comment.deleted_at.is_(None),
               func.coalesce(func.jsonb_typeof(Comment.reactions), "null") == "null")
        .order_by(Comment.created_at.desc())
        .limit(120)
    ).all()
    touched = 0
    for row in rows:
        if rng.random() < 0.45:
            continue
        emoji = rng.choice(("👍", "👀", "✅", "🙏", "🎉"))
        row.reactions = {emoji: rng.sample(people, rng.randint(1, min(3, len(people))))}
        touched += 1
    session.flush()
    return touched


def _t(kind: str, **fields: Any) -> dict[str, Any]:
    return {"kind": kind, **fields}


def _first(session, model, *clauses, order=None):
    statement = select(model).where(*clauses)
    if order is not None:
        statement = statement.order_by(order)
    return session.scalars(statement.limit(1)).first()
