"""Comments on any record (§36).

Polymorphic, like tags and favourites: `resource_type` + `resource_id` rather
than a column per entity, so a screen that wants a conversation gets one
without a migration. The alternative — `task_comments`, `ticket_comments` — is
a schema change every time somebody adds a page, which is exactly what a
template must not teach.

Three decisions worth stating.

**Reading a comment needs the record's own permission.** A conversation about a
ticket is part of the ticket; anybody who may open the record may read what was
said about it. Writing is separate (`records.comment`), because a reader who
may look at the ledger is not automatically somebody who may annotate it.

**Editing is the author's alone, and it is marked.** A comment that can be
silently rewritten is not a record of a conversation. `edited_at` is set on the
way through and rendered beside the body.

**Mentions are resolved at write time.** The ids of the people named with `@`
are stored alongside the body, so "what am I mentioned in?" is an indexed
question rather than a scan that re-parses every comment ever written.

**A commentable thing is not always an explorer resource.** Most are — a
ticket, a task, a project — and their permission comes from the declaration.
But a kanban card is not a business record with a field catalogue; who may
read it is decided by the *board* it is on. So the permission lookup is a
small registry (`COMMENTABLE`) rather than a hard call into the explorer, and
adding a screen that wants a conversation still needs no migration — only a
line saying which rule authorises it.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import ForbiddenError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.models.content import Comment
from src.services.explorer import resource_for

WRITE_PERMISSION = "records.comment"

#: Long enough for a paragraph of context, short enough that the column stays
#: a comment rather than a document. Documents have their own module (§20).
MAX_BODY = 4000

#: How many are returned at once. A conversation longer than this is one
#: nobody reads to the end anyway, and the count says how many there are.
PAGE = 200

#: `@Ada Administrator` — the display name, because that is what a person
#: types. Resolution to ids happens against the directory below.
_MENTION = re.compile(r"@([\w][\w'’.\-]*(?:\s+[\w][\w'’.\-]*)?)")


@dataclass(frozen=True, slots=True)
class Commentable:
    """A thing that can be talked about, and how to check who may.

    `authorise` raises if this reader may not see the record — which is the
    same thing as "may not read its conversation", because a conversation
    about a record is part of it. `label` is for the audit trail.
    """

    key: str
    authorise: Callable[[Any, Any, Any], None]
    label: Callable[[Any, Any], str]


def _kanban_card() -> Commentable:
    """A card's conversation is gated by the board it is on.

    Written here rather than declared as an explorer resource: a card is not a
    business record with a field catalogue, and giving it one to unlock
    comments would put board cards in the query builder, the export and the
    generic detail page — a great deal of machinery for a thing whose page is
    a drawer.
    """

    def authorise(session, record_id, principal) -> None:
        from src.services import kanban

        # Reading the card is the check; it raises `NotFoundError` for a board
        # this reader cannot see, which is the right answer — telling somebody
        # a card exists but is not theirs is itself a disclosure.
        kanban._card_row(session, record_id, principal)

    def label(session, record_id) -> str:
        from src.models.kanban import BoardCard

        row = session.get(BoardCard, record_id)
        return f"{row.reference} {row.title}" if row is not None else str(record_id)

    return Commentable(key="kanban_card", authorise=authorise, label=label)


def _calendar_event() -> Commentable:
    """An event's conversation is gated by being able to read the calendar.

    Not an explorer resource either, and for the same reason as a card: an
    event is not a business record with a field catalogue. Its read rule is
    simply `calendar.view` — an event sits in other people's weeks, so anybody
    who may look at the calendar may read what was said about a meeting in it.
    """

    def authorise(session, record_id, principal) -> None:
        from src.services import calendar

        # Reading the event is the check, and it raises `NotFoundError` for one
        # that has been cancelled — the same answer the drawer gets.
        principal.require(calendar.VIEW)
        calendar._event(session, record_id)

    def label(session, record_id) -> str:
        from src.models.business import CalendarEvent

        row = session.get(CalendarEvent, record_id)
        return row.title if row is not None else str(record_id)

    return Commentable(key="calendar_event", authorise=authorise, label=label)


#: The things that are commentable *without* being explorer resources.
#:
#: Everything absent from here is resolved through the explorer declarations,
#: which is where the great majority live.
COMMENTABLE: dict[str, Commentable] = {
    "kanban_card": _kanban_card(),
    "calendar_event": _calendar_event(),
}


def listing(session, args, *, principal) -> dict[str, Any]:
    """The conversation on one record, oldest first."""
    resource, record_id = _target(session, args, principal=principal)

    rows = session.scalars(
        select(Comment)
        .options(selectinload(Comment.author))
        .where(
            Comment.resource_type == resource.key,
            Comment.resource_id == str(record_id),
            Comment.deleted_at.is_(None),
        )
        # Oldest first: a conversation reads downwards, and a thread that
        # opens with its own ending is one nobody can follow.
        .order_by(Comment.is_pinned.desc(), Comment.created_at.asc())
        .limit(PAGE)
    ).unique().all()

    return {
        "items": [_serialize(row, principal) for row in rows],
        "total": len(rows),
        "resource_type": resource.key,
        "resource_id": str(record_id),
        "can_comment": principal.can(WRITE_PERMISSION),
    }


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Say something about a record. Audited, like every other write."""
    if not isinstance(payload, dict):
        raise ValidationError("The comment must be a JSON object.")
    principal.require(WRITE_PERMISSION)

    resource, record_id = _target(session, payload, principal=principal)
    body = _body(payload)
    parent = _parent(session, payload, resource, record_id)

    row = Comment(
        resource_type=resource.key,
        resource_id=str(record_id),
        parent_id=parent.id if parent else None,
        author_id=principal.user_id,
        body=body,
        mentions=_mentioned(session, body),
        is_internal=bool(payload.get("is_internal", False)),
    )
    session.add(row)
    session.flush()

    audit.record(
        session,
        action="COMMENT",
        resource_type=resource.key,
        resource_id=record_id,
        resource_label=_label(session, resource, record_id),
        principal=principal,
        after={"comment": body[:500]},
        message=f"commented on {_label(session, resource, record_id)}",
    )
    session.flush()
    return _serialize(row, principal)


def update(session, comment_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Change what was said — only by whoever said it, and visibly."""
    if not isinstance(payload, dict):
        raise ValidationError("The comment must be a JSON object.")
    row = _own(session, comment_id, principal)
    before = row.body

    row.body = _body(payload)
    row.mentions = _mentioned(session, row.body)
    # Marked rather than silent: a comment that can be rewritten with no trace
    # is not a record of a conversation.
    row.edited_at = now()
    session.flush()

    audit.record(
        session, action="UPDATE", resource_type=row.resource_type,
        resource_id=row.resource_id, principal=principal,
        before={"comment": before[:500]}, after={"comment": row.body[:500]},
        message="edited a comment", activity=False,
    )
    return _serialize(row, principal)


def remove(session, comment_id: Any, *, principal) -> dict[str, Any]:
    """Withdraw a comment. Soft, so the audit trail keeps what was said."""
    row = _own(session, comment_id, principal)
    row.deleted_at = now()
    audit.record(
        session, action="DELETE", resource_type=row.resource_type,
        resource_id=row.resource_id, principal=principal,
        before={"comment": row.body[:500]},
        message="deleted a comment", activity=False,
    )
    session.flush()
    return {"deleted": True, "id": str(row.id)}


# ── helpers ──────────────────────────────────────────────────────────────


def _target(session, source: Any, *, principal) -> tuple[Any, Any]:
    """The record a comment belongs to, checked against its own permission.

    Returns a `Commentable` for the non-explorer kinds so the rest of this
    module keeps talking to one shape — a key, and a way to label a row —
    rather than branching on the resource type in six places.
    """
    values = source if isinstance(source, dict) else {}
    if not values and source is not None:
        values = {key: source.get(key) for key in ("resource_type", "resource_id")}
    key = str(values.get("resource_type") or "")
    identifier = parse_uuid(values.get("resource_id"), field="resource_id")

    special = COMMENTABLE.get(key)
    if special is not None:
        # Its own rule authorises it: for a card that means reading the board,
        # which raises for one this reader cannot see.
        special.authorise(session, identifier, principal)
        return special, identifier
    return resource_for(key, principal=principal), identifier


def _authorise_existing(session, resource_type: str, resource_id: str, *, principal) -> None:
    """The same check, for a comment that is already stored.

    Reached when somebody edits or deletes one: the record's own permission
    still applies, because a comment is part of the record.
    """
    special = COMMENTABLE.get(resource_type)
    if special is not None:
        special.authorise(session, parse_uuid(resource_id, field="resource_id"), principal)
        return
    resource_for(resource_type, principal=principal)


def _body(payload: dict[str, Any]) -> str:
    body = str(payload.get("body") or "").strip()
    if not body:
        raise ValidationError("A comment cannot be empty.", details={"field": "body"})
    if len(body) > MAX_BODY:
        raise ValidationError(
            f"A comment is at most {MAX_BODY} characters.",
            details={"field": "body", "length": len(body), "maximum": MAX_BODY},
        )
    return body


def _parent(session, payload: dict[str, Any], resource, record_id) -> Comment | None:
    """The comment being replied to, if there is one and it belongs here."""
    raw = payload.get("parent_id")
    if not raw:
        return None
    parent = session.scalars(
        select(Comment).where(
            Comment.id == parse_uuid(raw, field="parent_id"),
            Comment.deleted_at.is_(None),
        )
    ).one_or_none()
    if parent is None:
        raise NotFoundError("That comment does not exist.", details={"parent_id": str(raw)})
    if parent.resource_type != resource.key or parent.resource_id != str(record_id):
        # A reply that lands on a different record is how a conversation ends
        # up quoting something nobody on this page can see.
        raise ValidationError(
            "A reply must be on the same record as the comment it answers.",
            details={"parent_id": str(raw)},
        )
    return parent


def _own(session, comment_id: Any, principal) -> Comment:
    row = session.scalars(
        select(Comment)
        .options(selectinload(Comment.author))
        .where(
            Comment.id == parse_uuid(comment_id, field="comment_id"),
            Comment.deleted_at.is_(None),
        )
    ).unique().one_or_none()
    if row is None:
        raise NotFoundError("That comment does not exist.")
    # The record's own permission still applies: a comment is part of it.
    _authorise_existing(session, row.resource_type, row.resource_id, principal=principal)
    if row.author_id != principal.user_id:
        raise ForbiddenError(
            "Only the author may change a comment.",
            details={"comment_id": str(row.id), "author_id": str(row.author_id)},
        )
    return row


def _mentioned(session, body: str) -> list[str]:
    """The ids of the people named with `@`, resolved once at write time.

    Stored rather than re-parsed, so "what am I mentioned in?" is an indexed
    question rather than a scan over every comment ever written.
    """
    from src.models.identity import User

    names = {match.strip() for match in _MENTION.findall(body)}
    if not names:
        return []
    rows = session.execute(
        select(User.id, User.full_name, User.username).where(
            User.deleted_at.is_(None), User.status == "ACTIVE"
        )
    ).all()
    lowered = {name.lower() for name in names}
    return [
        str(user_id)
        for user_id, full_name, username in rows
        if (full_name or "").lower() in lowered or (username or "").lower() in lowered
    ]


def _label(session, resource, record_id) -> str:
    if isinstance(resource, Commentable):
        return resource.label(session, record_id)
    row = session.get(resource.model, record_id)
    return resource.label_for(row) if row is not None else str(record_id)


def _serialize(row: Comment, principal) -> dict[str, Any]:
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
        "is_internal": row.is_internal,
        "is_pinned": row.is_pinned,
        "edited_at": iso(row.edited_at),
        "created_at": iso(row.created_at),
        # Whether *this* reader may change it, so the page shows the control
        # rather than discovering the refusal after somebody has typed (§76).
        "can_edit": row.author_id == principal.user_id,
    }
