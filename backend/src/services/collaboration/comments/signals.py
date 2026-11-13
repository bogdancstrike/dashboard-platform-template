"""What a comment sets off: audit, read marks, notifications, live events."""

from __future__ import annotations

from typing import Any

from src.core.clock import iso, now
from src.core.pagination import parse_uuid
from src.models.content import Comment
from src.services.collaboration.comments.access import _link_for, _target
from src.services.collaboration.comments.targets import Commentable


def mark_read(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Move the reader's "read up to here" to now, and tell the others."""
    resource, record_id = _target(session, payload or {}, principal=principal)
    moment = now()
    _mark(session, principal.user_id, resource.key, str(record_id), moment)
    session.flush()
    _publish(session, resource, record_id, {
        "type": "thread.read",
        "resource_type": resource.key,
        "resource_id": str(record_id),
        "user_id": str(principal.user_id),
        "last_read_at": iso(moment),
    })
    return {"resource_type": resource.key, "resource_id": str(record_id), "last_read_at": iso(moment)}


def typing(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Say "somebody is typing" to whoever else is in the conversation.

    Sent by the browser at most every few seconds while a composer has text,
    and never stored: it is true for about five seconds and then it is not.
    """
    resource, record_id = _target(session, payload or {}, principal=principal)
    _publish(session, resource, record_id, {
        "type": "typing",
        "resource_type": resource.key,
        "resource_id": str(record_id),
        "user": {"id": str(principal.user_id), "name": principal.full_name},
    }, exclude=str(principal.user_id))
    return {"sent": True}


def _audited(resource) -> bool:
    return not isinstance(resource, Commentable) or resource.audited


def _mark(session, user_id, resource_type: str, resource_id: str, moment) -> None:
    """Upsert one "read up to here", never moving it backwards."""
    from sqlalchemy.dialects.postgresql import insert

    from src.models.collab import ThreadRead

    statement = insert(ThreadRead).values(
        user_id=user_id, resource_type=resource_type, resource_id=resource_id, last_read_at=moment,
    )
    session.execute(
        statement.on_conflict_do_update(
            constraint="uq_thread_reads_user_thread",
            set_={"last_read_at": statement.excluded.last_read_at, "updated_at": now()},
            where=ThreadRead.last_read_at < statement.excluded.last_read_at,
        )
    )


def _touch(session, resource, record_id, moment) -> None:
    """A channel remembers when it last spoke, so its list sorts by activity."""
    if isinstance(resource, Commentable) and resource.key == "chat_channel":
        from src.models.collab import ChatChannel

        channel = session.get(ChatChannel, record_id)
        if channel is not None:
            channel.last_message_at = moment


def _notify_mentions(session, row: Comment, resource, record_id, label: str, principal, *, skip=()) -> None:
    """Tell each person named with `@` — except the author, and anyone told already."""
    from src.services.collaboration import notifications

    excerpt = row.body if len(row.body) <= 160 else f"{row.body[:157]}…"
    where = f"#{label}" if getattr(resource, "key", "") == "chat_channel" else label
    for person in row.mentions or []:
        if person == str(principal.user_id) or person in skip:
            continue
        notifications.publish(
            session,
            user_id=parse_uuid(person, field="user_id"),
            title=f"{principal.full_name} mentioned you in {where}",
            body=excerpt,
            category="MENTION",
            link=_link_for(resource, record_id),
            icon="at",
            resource_type=resource.key,
            resource_id=str(record_id),
            actor=principal,
            group_key=f"mention:{resource.key}:{record_id}",
        )


def _publish(session, resource, record_id, payload: dict[str, Any], *, exclude: str | None = None) -> None:
    """Hand a hint to whoever is in the conversation. Never raises."""
    from src.services.collaboration import live

    try:
        audience = None
        if isinstance(resource, Commentable) and resource.audience is not None:
            audience = resource.audience(session, record_id)
        if audience is None:
            live.publish_to_all(payload)
            return
        for person in audience:
            if person != exclude:
                live.publish_to_user(person, payload)
    except Exception:  # pragma: no cover - delivery is best-effort by contract
        from framework.commons.logger import logger as log

        log.debug("comments: a live hint was not delivered")


def _announce(session, resource, record_id, action: str, row: Comment, principal) -> None:
    """Tell the conversation a line arrived, changed or went.

    A hint, not the line: the browser re-reads the conversation through the
    endpoint that checks who may see it, so nothing private rides the socket.
    """
    _publish(session, resource, record_id, {
        "type": "thread",
        "action": action,
        "resource_type": resource.key,
        "resource_id": str(record_id),
        "comment_id": str(row.id),
        "parent_id": str(row.parent_id) if row.parent_id else None,
        "author_id": str(principal.user_id),
    })
