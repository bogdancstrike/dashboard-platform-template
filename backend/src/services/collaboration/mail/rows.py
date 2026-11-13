"""Limits, and the mailbox rows a reader owns."""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core.errors import ForbiddenError, NotFoundError
from src.core.pagination import parse_uuid
from src.models.content import EmailMessage, EmailThread

#: Holding this is having a mailbox at all. There is no second permission for
#: writing to it: nobody can read somebody else's, so nobody can write to one.
PERMISSION = "mail.access"


#: The folders a person can move a thread into by hand. `SENT` and `OUTBOX` are
#: where the platform puts things, and letting somebody file an inbound message
#: into `SENT` would make the folder mean nothing.
MOVABLE = ("INBOX", "ARCHIVE", "SPAM", "TRASH")


MAX_SUBJECT = 300


MAX_BODY = 100_000


MAX_RECIPIENTS = 100


MAX_LABELS = 12


#: `{{ name }}` in an email template. A whitelist substitution rather than
#: `str.format`, which would let a template reach into the objects it is given.
_PLACEHOLDER = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")


_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _me(principal) -> UUID:
    principal.require(PERMISSION)
    me = getattr(principal, "user_id", None)
    if me is None:
        raise ForbiddenError("A mailbox belongs to somebody.")
    return me


def _owned(me: UUID):
    """The one predicate that makes this a *person's* mailbox.

    Every read goes through it. There is no sharing scope here on purpose: a
    mailbox is not that kind of object, and the moment one exists every
    endpoint needs a second rule about whose mail this is.
    """
    return (
        select(EmailThread)
        .options(selectinload(EmailThread.messages))
        .where(EmailThread.owner_id == me, EmailThread.deleted_at.is_(None))
    )


def _thread_row(session, thread_id: Any, principal) -> EmailThread:
    me = _me(principal)
    row = session.scalar(_owned(me).where(EmailThread.id == parse_uuid(thread_id, field="thread_id")))
    if row is None:
        # `NotFoundError` and not `ForbiddenError`: telling somebody a thread
        # exists but is not theirs is itself a disclosure.
        raise NotFoundError("That conversation does not exist.")
    return row


def _message_row(session, message_id: Any, principal) -> EmailMessage:
    me = _me(principal)
    row = session.get(EmailMessage, parse_uuid(message_id, field="message_id"))
    if row is None or row.deleted_at is not None or row.owner_id != me:
        raise NotFoundError("That message does not exist.")
    return row


def _recount(session, row: EmailThread) -> None:
    """Recompute the thread's denormalised summary from its messages.

    Recomputed and never adjusted. These columns exist so an inbox list draws
    without joining messages — which is worth having — but a decremented
    counter drifts the first time two things happen at once, and a wrong unread
    badge is the single most irritating bug a mail client can have.
    """
    session.flush()
    # Expired first, then read. `_owned` loads `messages` eagerly, so the
    # collection in memory is the one from *before* this write — a reply
    # counted as no reply at all, and the thread's own message count silently
    # stopped moving.
    session.expire(row, ["messages"])
    live = [item for item in row.messages if item.deleted_at is None]
    row.message_count = len(live)
    row.unread_count = sum(1 for item in live if not item.is_read)
    row.has_attachments = any((item.attachment_count or 0) > 0 for item in live)

    latest = max(live, key=lambda item: (item.sent_at or item.created_at), default=None)
    if latest is not None:
        row.last_message_at = latest.sent_at or latest.created_at
        row.snippet = (latest.preview or latest.body_text or "")[:400] or None

    # The people in the conversation, in the order they first appear — which is
    # how a mail client names a thread ("Ada, Mara, you").
    seen: dict[str, str] = {}
    for item in sorted(live, key=lambda entry: (entry.sent_at or entry.created_at)):
        if item.from_email:
            seen.setdefault(item.from_email, item.from_name or item.from_email)
        for entry in item.to_recipients or []:
            if isinstance(entry, dict) and entry.get("email"):
                seen.setdefault(str(entry["email"]), str(entry.get("name") or entry["email"]))
    row.participants = [{"email": email, "name": name} for email, name in seen.items()] or None
    session.flush()
