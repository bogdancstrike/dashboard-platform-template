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
from src.services.records.explorer import resource_for

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

    The rest is what a *chat channel* needs and a record does not, with the
    record's behaviour as the default:

    * `audited` — a ticket's conversation belongs in the audit trail and the
      activity feed; a channel's small talk would bury both.
    * `audience` — who hears about a new line live. `None` is everybody
      connected (a record's thread: the hint names only ids); a channel names
      its members.
    * `before_write` — a gate on writing beyond `records.comment`: posting in
      a channel needs membership (or joins a public one).
    * `link` — where a mention notification sends its reader.
    * `permission` — what writing needs, when it is not `records.comment`.
    """

    key: str
    authorise: Callable[[Any, Any, Any], None]
    label: Callable[[Any, Any], str]
    audited: bool = True
    audience: Callable[[Any, Any], list[str] | None] | None = None
    before_write: Callable[[Any, Any, Any], None] | None = None
    link: Callable[[Any], str] | None = None
    permission: str = WRITE_PERMISSION


def _kanban_card() -> Commentable:
    """A card's conversation is gated by the board it is on.

    Written here rather than declared as an explorer resource: a card is not a
    business record with a field catalogue, and giving it one to unlock
    comments would put board cards in the query builder, the export and the
    generic detail page — a great deal of machinery for a thing whose page is
    a drawer.
    """

    def authorise(session, record_id, principal) -> None:
        from src.services.work import kanban

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
        from src.services.work import calendar

        # Reading the event is the check, and it raises `NotFoundError` for one
        # that has been cancelled — the same answer the drawer gets.
        principal.require(calendar.VIEW)
        calendar._event(session, record_id)

    def label(session, record_id) -> str:
        from src.models.business import CalendarEvent

        row = session.get(CalendarEvent, record_id)
        return row.title if row is not None else str(record_id)

    return Commentable(key="calendar_event", authorise=authorise, label=label)


def _chat_channel() -> Commentable:
    """A channel's messages are its comments; membership is the rule."""
    from src.services.collaboration import chat

    return Commentable(
        key=chat.RESOURCE,
        authorise=chat.authorise_read,
        label=chat.label,
        audited=False,
        audience=chat.audience,
        before_write=chat.authorise_write,
        link=lambda record_id: f"/chat/{record_id}",
        permission=chat.USE,
    )


#: The things that are commentable *without* being explorer resources.
#:
#: Everything absent from here is resolved through the explorer declarations,
#: which is where the great majority live.
COMMENTABLE: dict[str, Commentable] = {
    "kanban_card": _kanban_card(),
    "calendar_event": _calendar_event(),
    "chat_channel": _chat_channel(),
}

#: The reactions offered. Free text would be a vector for anything at all in a
#: JSON key; a short list is also what makes the picker one tap.
REACTIONS: tuple[str, ...] = (
    "👍", "❤️", "🎉", "😄", "👀", "🚀", "✅", "🙏", "🔥", "😮", "😢", "👏",
)

#: How many files one message may carry.
MAX_ATTACHMENTS = 8

#: Where a record's page lives, for a mention notification's link.
_RECORD_PATHS = {
    "task": "/tasks", "project": "/projects", "customer": "/customers",
    "order": "/orders", "ticket": "/tickets", "device": "/devices",
}


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


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Say something about a record. Audited, like every other write."""
    if not isinstance(payload, dict):
        raise ValidationError("The comment must be a JSON object.")
    # The permission depends on what is being talked about — a channel needs
    # `chat.use`, a record `records.comment` — so it is checked once the
    # target is known, but before anything about the body is.
    key = str(payload.get("resource_type") or "")
    special = COMMENTABLE.get(key)
    principal.require(special.permission if special else WRITE_PERMISSION)

    resource, record_id = _target(session, payload, principal=principal)
    _require_record(session, resource, record_id)
    if isinstance(resource, Commentable) and resource.before_write is not None:
        resource.before_write(session, record_id, principal)
    attachments = _attachments(session, payload, principal)
    body = _body(payload, allow_empty=bool(attachments))
    parent = _parent(session, payload, resource, record_id)

    row = Comment(
        resource_type=resource.key,
        resource_id=str(record_id),
        parent_id=parent.id if parent else None,
        author_id=principal.user_id,
        body=body,
        mentions=_mentioned(session, body, payload.get("mention_ids")),
        attachments=attachments or None,
        is_internal=bool(payload.get("is_internal", False)),
    )
    session.add(row)
    session.flush()

    label = _label(session, resource, record_id)
    if _audited(resource):
        audit.record(
            session,
            action="COMMENT",
            resource_type=resource.key,
            resource_id=record_id,
            resource_label=label,
            principal=principal,
            after={"comment": body[:500]},
            message=f"commented on {label}",
        )
    _touch(session, resource, record_id, row.created_at)
    # Writing is reading: the author has seen everything up to their own line.
    _mark(session, principal.user_id, resource.key, str(record_id), row.created_at)
    _notify_mentions(session, row, resource, record_id, label, principal)
    session.flush()
    _announce(session, resource, record_id, "created", row, principal)
    return _serialize(row, principal)


def update(session, comment_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Change what was said — only by whoever said it, and visibly."""
    if not isinstance(payload, dict):
        raise ValidationError("The comment must be a JSON object.")
    row = _own(session, comment_id, principal)
    before = row.body

    row.body = _body(payload, allow_empty=bool(row.attachments))
    previously = set(row.mentions or [])
    row.mentions = _mentioned(session, row.body, payload.get("mention_ids"))
    # Marked rather than silent: a comment that can be rewritten with no trace
    # is not a record of a conversation.
    row.edited_at = now()
    session.flush()

    resource = _resource_of(row, principal)
    if _audited(resource):
        audit.record(
            session, action="UPDATE", resource_type=row.resource_type,
            resource_id=row.resource_id, principal=principal,
            before={"comment": before[:500]}, after={"comment": row.body[:500]},
            message="edited a comment", activity=False,
        )
    # Somebody added in an edit was mentioned too; somebody already told is not
    # told twice.
    _notify_mentions(
        session, row, resource, row.resource_id,
        _label(session, resource, parse_uuid(row.resource_id, field="resource_id")),
        principal, skip=previously,
    )
    _announce(session, resource, row.resource_id, "updated", row, principal)
    return _serialize(row, principal)


def remove(session, comment_id: Any, *, principal) -> dict[str, Any]:
    """Withdraw a comment. Soft, so the audit trail keeps what was said."""
    row = _own(session, comment_id, principal)
    row.deleted_at = now()
    resource = _resource_of(row, principal)
    if _audited(resource):
        audit.record(
            session, action="DELETE", resource_type=row.resource_type,
            resource_id=row.resource_id, principal=principal,
            before={"comment": row.body[:500]},
            message="deleted a comment", activity=False,
        )
    session.flush()
    _announce(session, resource, row.resource_id, "deleted", row, principal)
    return {"deleted": True, "id": str(row.id)}


def react(session, comment_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Add or take back one reaction. Anybody who may read the line may react."""
    emoji = str((payload or {}).get("emoji") or "")
    if emoji not in REACTIONS:
        raise ValidationError(
            "That reaction is not one of the offered ones.",
            details={"field": "emoji", "allowed": list(REACTIONS)},
        )
    row = _readable(session, comment_id, principal)
    reactions = {key: list(value) for key, value in (row.reactions or {}).items()}
    people = reactions.get(emoji, [])
    me_id = str(principal.user_id)
    if me_id in people:
        people.remove(me_id)
    else:
        people.append(me_id)
    if people:
        reactions[emoji] = people
    else:
        reactions.pop(emoji, None)
    # A new dict, so SQLAlchemy sees the change to a JSONB column.
    row.reactions = reactions or None
    session.flush()
    _announce(session, _resource_of(row, principal), row.resource_id, "reaction", row, principal)
    return _serialize(row, principal, names=_names(session, [row]))


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


def _body(payload: dict[str, Any], *, allow_empty: bool = False) -> str:
    body = str(payload.get("body") or "").strip()
    if not body and allow_empty:
        return ""
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


def _readable(session, comment_id: Any, principal) -> Comment:
    """A live comment this reader may see, by the record's own rule."""
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
    _authorise_existing(session, row.resource_type, row.resource_id, principal=principal)
    return row


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


def _mentioned(session, body: str, explicit: Any = None) -> list[str]:
    """The ids of the people named with `@`, resolved once at write time.

    Stored rather than re-parsed, so "what am I mentioned in?" is an indexed
    question rather than a scan over every comment ever written.

    `explicit` is the ids the composer's people picker chose. They are only
    trusted when the body still names that person — a mention deleted from the
    text before sending is not a mention — and only for real, active people.
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
    text = body.lower()
    chosen = {str(item) for item in explicit} if isinstance(explicit, list) else set()
    found: list[str] = []
    for user_id, full_name, username in rows:
        full = (full_name or "").lower()
        handle = (username or "").lower()
        # The regex takes up to two words after `@`; a picked person with a
        # longer name is still found by their whole name in the text.
        if full in lowered or handle in lowered or (
            str(user_id) in chosen and full and f"@{full}" in text
        ):
            found.append(str(user_id))
    return found


def _require_record(session, resource, record_id) -> None:
    """A comment needs a record to belong to.

    Without this, a comment on any well-formed id — a deleted ticket, a typo,
    `00000000-…` — was stored (201) and hung off nothing, visible to nobody
    and counted by the activity feed (found by the edge-case pass,
    docs/testing/security-edge-cases.md). The kinds in `COMMENTABLE` check
    their own records in `authorise`.
    """
    if isinstance(resource, Commentable):
        return
    row = session.get(resource.model, record_id)
    if row is None or getattr(row, "deleted_at", None) is not None:
        raise NotFoundError(
            f"That {resource.label.lower().rstrip('s')} does not exist.",
            details={"resource_type": resource.key, "id": str(record_id)},
        )


def _label(session, resource, record_id) -> str:
    if isinstance(resource, Commentable):
        return resource.label(session, record_id)
    row = session.get(resource.model, record_id)
    return resource.label_for(row) if row is not None else str(record_id)


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


# ── chat and live helpers ────────────────────────────────────────────────


def _may_write(resource, principal) -> bool:
    if isinstance(resource, Commentable):
        return principal.can(resource.permission)
    return principal.can(WRITE_PERMISSION)


def _audited(resource) -> bool:
    return not isinstance(resource, Commentable) or resource.audited


def _resource_of(row: Comment, principal):
    special = COMMENTABLE.get(row.resource_type)
    if special is not None:
        return special
    return resource_for(row.resource_type, principal=principal)


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


def _attachments(session, payload: dict[str, Any], principal) -> list[dict[str, Any]]:
    """Files to send with the line: ids of files this person may read."""
    from src.models.content import FileObject

    raw = payload.get("attachment_ids") or []
    if not isinstance(raw, list):
        raise ValidationError("attachment_ids must be a list.", details={"field": "attachment_ids"})
    if len(raw) > MAX_ATTACHMENTS:
        raise ValidationError(
            f"At most {MAX_ATTACHMENTS} files may go with one message.",
            details={"field": "attachment_ids", "maximum": MAX_ATTACHMENTS},
        )
    if not raw:
        return []
    principal.require("files.view")
    ids = [parse_uuid(item, field="attachment_ids") for item in raw]
    files = {
        row.id: row
        for row in session.scalars(
            select(FileObject).where(FileObject.id.in_(ids), FileObject.deleted_at.is_(None))
        ).all()
    }
    missing = [str(item) for item in ids if item not in files]
    if missing:
        raise NotFoundError("A file to attach does not exist.", details={"attachment_ids": missing})
    return [
        {
            "id": str(item),
            "name": files[item].name,
            "size_bytes": int(getattr(files[item], "size_bytes", 0) or 0),
            "mime_type": getattr(files[item], "mime_type", None),
        }
        for item in ids
    ]


def _link_for(resource, record_id) -> str:
    if isinstance(resource, Commentable):
        return resource.link(record_id) if resource.link else ""
    return f"{_RECORD_PATHS.get(resource.key, '/explore')}/{record_id}"


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
