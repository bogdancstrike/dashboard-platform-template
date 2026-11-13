"""What a thread view adds to each comment: reply counts, reactors' names, read marks."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import iso
from src.core.pagination import parse_uuid
from src.models.content import Comment


def _reply_counts(session, resource_type: str, resource_id: str, ids: list[Any]) -> dict[str, tuple[int, Any]]:
    """How many replies each line has, and when the latest came."""
    from sqlalchemy import func

    if not ids:
        return {}
    rows = session.execute(
        select(Comment.parent_id, func.count(), func.max(Comment.created_at))
        .where(
            Comment.resource_type == resource_type,
            Comment.resource_id == resource_id,
            Comment.parent_id.in_(ids),
            Comment.deleted_at.is_(None),
        )
        .group_by(Comment.parent_id)
    ).all()
    return {str(parent): (int(count), latest) for parent, count, latest in rows}


def _names(session, rows: list[Comment]) -> dict[str, str]:
    """Display names for everybody who reacted to these lines."""
    from src.models.identity import User

    people = {person for row in rows for values in (row.reactions or {}).values() for person in values}
    if not people:
        return {}
    ids = [parse_uuid(person, field="user_id") for person in people]
    return {
        str(user_id): name
        for user_id, name in session.execute(select(User.id, User.full_name).where(User.id.in_(ids))).all()
    }


def _reads(session, resource_type: str, resource_id: str) -> list[dict[str, Any]]:
    from src.models.collab import ThreadRead
    from src.models.identity import User

    rows = session.execute(
        select(ThreadRead.user_id, ThreadRead.last_read_at, User.full_name, User.avatar_url)
        .join(User, User.id == ThreadRead.user_id)
        .where(ThreadRead.resource_type == resource_type, ThreadRead.resource_id == resource_id)
        .order_by(ThreadRead.last_read_at.desc())
        .limit(50)
    ).all()
    return [
        {"user_id": str(user_id), "name": name, "avatar_url": avatar, "last_read_at": iso(moment)}
        for user_id, moment, name, avatar in rows
    ]
