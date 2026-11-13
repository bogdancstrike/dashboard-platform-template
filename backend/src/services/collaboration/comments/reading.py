"""A thread of comments, with reply counts, reactions and read marks."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core.clock import iso
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.models.content import Comment
from src.services.collaboration.comments.access import _may_write, _target
from src.services.collaboration.comments.targets import PAGE, REACTIONS
from src.services.collaboration.comments.thread_facts import (
    _names,
    _reads,
    _reply_counts,
)


def listing(session, args, *, principal) -> dict[str, Any]:
    """The conversation on one record, oldest first.

    Three shapes, by argument:

    * no window — the whole conversation (up to `PAGE`), replies included, the
      way a record's thread has always read;
    * `limit` (and optionally `before`, an ISO time) — the newest `limit`
      top-level lines older than `before`, still returned oldest first, with
      `has_more` saying whether scrolling up would find anything. A channel
      with a year of history is read this way;
    * `parent_id` — the replies to one line, which is what a thread panel
      shows.
    """
    resource, record_id = _target(session, args, principal=principal)
    clauses = [
        Comment.resource_type == resource.key,
        Comment.resource_id == str(record_id),
        Comment.deleted_at.is_(None),
    ]

    parent_raw = args.get("parent_id") if hasattr(args, "get") else None
    limit_raw = args.get("limit") if hasattr(args, "get") else None
    has_more = False
    if parent_raw:
        clauses.append(Comment.parent_id == parse_uuid(parent_raw, field="parent_id"))
        rows = session.scalars(
            select(Comment).options(selectinload(Comment.author)).where(*clauses)
            .order_by(Comment.created_at.asc()).limit(PAGE)
        ).unique().all()
    elif limit_raw:
        limit = _bounded_limit(limit_raw)
        clauses.append(Comment.parent_id.is_(None))
        before = args.get("before")
        if before:
            clauses.append(Comment.created_at < _moment(before))
        newest = session.scalars(
            select(Comment).options(selectinload(Comment.author)).where(*clauses)
            .order_by(Comment.created_at.desc()).limit(limit + 1)
        ).unique().all()
        has_more = len(newest) > limit
        rows = list(reversed(newest[:limit]))
    else:
        rows = session.scalars(
            select(Comment)
            .options(selectinload(Comment.author))
            .where(*clauses)
            # Oldest first: a conversation reads downwards, and a thread that
            # opens with its own ending is one nobody can follow.
            .order_by(Comment.is_pinned.desc(), Comment.created_at.asc())
            .limit(PAGE)
        ).unique().all()

    replies = _reply_counts(session, resource.key, str(record_id), [row.id for row in rows])
    names = _names(session, rows)
    reads = _reads(session, resource.key, str(record_id))
    mine = next((item for item in reads if item["user_id"] == str(principal.user_id)), None)

    return {
        "items": [_serialize(row, principal, replies=replies, names=names) for row in rows],
        "total": len(rows),
        "has_more": has_more,
        "resource_type": resource.key,
        "resource_id": str(record_id),
        "can_comment": _may_write(resource, principal),
        # Everybody's "read up to here", for "seen by" under a line; and the
        # reader's own, for the "new" divider — read *before* this listing,
        # because opening the page is what moves it.
        "reads": [item for item in reads if item["user_id"] != str(principal.user_id)],
        "my_last_read_at": mine["last_read_at"] if mine else None,
        "reactions": list(REACTIONS),
    }


def _serialize(
    row: Comment,
    principal,
    *,
    replies: dict[str, tuple[int, Any]] | None = None,
    names: dict[str, str] | None = None,
) -> dict[str, Any]:
    reply_count, last_reply_at = (replies or {}).get(str(row.id), (0, None))
    me_id = str(principal.user_id)
    return {
        "id": str(row.id),
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "parent_id": str(row.parent_id) if row.parent_id else None,
        "body": row.body,
        "author": {
            "id": str(row.author_id) if row.author_id else "",
            "name": row.author.full_name if row.author else "Former user",
            "avatar_url": row.author.avatar_url if row.author else None,
            "job_title": row.author.job_title if row.author else None,
        },
        "mentions": list(row.mentions or []),
        "reactions": [
            {
                "emoji": emoji,
                "count": len(people),
                "mine": me_id in people,
                "people": [(names or {}).get(person, "Somebody") for person in people][:12],
            }
            for emoji, people in (row.reactions or {}).items()
            if people
        ],
        "attachments": list(row.attachments or []),
        "reply_count": reply_count,
        "last_reply_at": iso(last_reply_at),
        "is_internal": row.is_internal,
        "is_pinned": row.is_pinned,
        "edited_at": iso(row.edited_at),
        "created_at": iso(row.created_at),
        # Whether *this* reader may change it, so the page shows the control
        # rather than discovering the refusal after somebody has typed (§76).
        "can_edit": row.author_id == principal.user_id,
    }


def _bounded_limit(raw: Any) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ValidationError("limit must be a whole number.", details={"field": "limit"}) from None
    return max(1, min(value, PAGE))


def _moment(raw: Any):
    from datetime import datetime

    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        raise ValidationError("before must be an ISO date and time.", details={"field": "before"}) from None
