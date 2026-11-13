"""A folder of threads with counts and labels, and one thread."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select

from src.core.clock import now
from src.core.errors import ValidationError
from src.core.pagination import Page, envelope
from src.core.vocabulary import EMAIL_FOLDER, EMAIL_PRIORITY
from src.models.content import EmailThread
from src.services.collaboration.mail.rows import (
    MOVABLE,
    _me,
    _owned,
    _recount,
    _thread_row,
)
from src.services.collaboration.mail.serializers import _thread
from src.services.collaboration.mail.validation import _folder


def threads(session, args, page: Page, *, principal) -> dict[str, Any]:
    """One folder of this reader's mailbox, newest first.

    The folder counts come with it, computed over the whole mailbox in one
    query rather than per folder: a sidebar that asked for seven counts would
    be seven round trips to draw a list of seven words (§71).
    """
    me = _me(principal)
    folder = _folder(args.get("folder"), default="INBOX")

    statement = _owned(me).where(EmailThread.folder == folder)

    term = str(args.get("q") or "").strip()
    if term:
        if len(term) > 200:
            raise ValidationError("A mailbox search is at most 200 characters.")
        like = f"%{term.lower()}%"
        # Subject and snippet only. Searching bodies means a join to messages
        # on every keystroke; the snippet is the first 200 characters of the
        # latest one, which is what somebody is usually remembering.
        statement = statement.where(
            or_(
                func.lower(EmailThread.subject).like(like),
                func.lower(EmailThread.snippet).like(like),
            )
        )

    label = str(args.get("label") or "").strip()
    if label:
        statement = statement.where(EmailThread.labels.any(label))

    if str(args.get("starred") or "") in ("1", "true", "True"):
        statement = statement.where(EmailThread.is_starred.is_(True))
    if str(args.get("unread") or "") in ("1", "true", "True"):
        statement = statement.where(EmailThread.unread_count > 0)

    total = int(session.scalar(select(func.count()).select_from(statement.subquery())) or 0)
    rows = session.scalars(
        statement.order_by(
            EmailThread.last_message_at.desc().nullslast(),
            EmailThread.created_at.desc(),
        )
        .offset(page.offset)
        .limit(page.page_size)
    ).unique().all()

    # `envelope` and not a dict of its own: every list in this platform is
    # paginated the same way, and a second shape here would be a second thing
    # the frontend's client has to understand.
    return envelope(
        [_thread(row) for row in rows],
        total,
        page,
        folder=folder,
        folders=_folder_counts(session, me),
        labels=_labels(session, me, folder),
        priorities=list(EMAIL_PRIORITY),
        movable=list(MOVABLE),
    )


def _folder_counts(session, me: UUID) -> list[dict[str, Any]]:
    """Every folder, its size and its unread count — in one query.

    Ordered by the declared vocabulary rather than by the counts, so the
    sidebar does not reorder itself as mail arrives. A folder with nothing in
    it is still listed: an empty Drafts is information, and a sidebar that
    hides folders until they fill teaches nobody where anything goes.
    """
    rows = session.execute(
        select(
            EmailThread.folder,
            func.count().label("total"),
            func.coalesce(func.sum(EmailThread.unread_count), 0).label("unread"),
        )
        .where(EmailThread.owner_id == me, EmailThread.deleted_at.is_(None))
        .group_by(EmailThread.folder)
    ).all()
    found = {row.folder: (int(row.total), int(row.unread)) for row in rows}
    return [
        {
            "key": name,
            "total": found.get(name, (0, 0))[0],
            "unread": found.get(name, (0, 0))[1],
        }
        for name in EMAIL_FOLDER
    ]


def _labels(session, me: UUID, folder: str) -> list[dict[str, Any]]:
    """The labels in use *in this folder*, with how many threads carry each.

    Read from the rows rather than from a catalogue: a label list offering
    twelve names when three are used is a filter that mostly returns nothing.

    Counted within the folder, and not across the mailbox, because that is the
    folder the filter will search. A mailbox-wide count beside a folder-scoped
    filter promises rows the click cannot find — which is worse than no count
    at all, because the reader concludes the filter is broken.
    """
    rows = session.scalars(
        select(EmailThread.labels).where(
            EmailThread.owner_id == me,
            EmailThread.folder == folder,
            EmailThread.deleted_at.is_(None),
            EmailThread.labels.isnot(None),
        )
    ).all()
    counts: dict[str, int] = {}
    for labels in rows:
        for label in labels or []:
            counts[str(label)] = counts.get(str(label), 0) + 1
    return [
        {"key": key, "count": count}
        for key, count in sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))
    ]


def thread(session, thread_id: Any, args, *, principal) -> dict[str, Any]:
    """One thread with its messages, oldest first — and marked read.

    Marking on read is honest: these messages *were* on screen. `?peek=1`
    reads without marking, for the places that show a thread without somebody
    looking at it.
    """
    row = _thread_row(session, thread_id, principal)
    peek = str((args or {}).get("peek") or "") in ("1", "true", "True")

    if not peek and row.unread_count:
        stamp = now()
        for message in row.messages:
            if not message.is_read:
                message.is_read = True
                message.read_at = stamp
        _recount(session, row)

    return _thread(row, messages=True)
