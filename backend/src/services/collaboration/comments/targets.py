"""What can be commented on, and who may."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

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
