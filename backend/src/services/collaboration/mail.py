"""The mailbox (§14–§16): threads, messages, drafts and sending.

Five decisions shape this module.

**A mailbox belongs to exactly one person, and that is the whole access
model.** Every query here is scoped to `owner_id == me`. There is no sharing
scope, no polymorphic share table and no "public" mailbox, because a mailbox is
not that kind of object — and the moment one exists, every endpoint needs a
second rule about whose mail this is. `mail.access` says you have a mailbox;
your own id says which.

**The thread is the unit of the list, and its counts are recomputed rather
than adjusted.** `message_count`, `unread_count`, `snippet` and `participants`
are denormalised onto the thread on purpose — an inbox list that joined
messages to render a row is an inbox nobody waits for. But a *decremented*
counter drifts the first time two things happen at once, so every write that
could change one recomputes all of them from the messages. One function,
`_recount`, and nothing else touches those columns.

**Reading a thread marks its messages read, and that is a write.** Honest
rather than clever: they *were* on screen. The same reasoning as the
announcements board, and the same consequence — the count on the folder is a
fact about rows, not about what the browser has drawn.

**Sending puts a message in OUTBOX, not in SENT.** There is no mail transport
in this template. Writing `SENT` would have the mailbox claim a delivery it
cannot make, and a demo that lies about the one thing a mail client is for is
worse than one that says "queued". §23 is where the transport goes.

**A draft is a message, not a separate kind of thing.** `is_draft` and a null
`sent_at`, in the same table, so a draft appears in searches, carries
attachments, and becomes a sent message by being sent — rather than being
copied from one table into another and leaving two ids behind.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import ForbiddenError, NotFoundError, ValidationError
from src.core.naming import identifier, initials, sequence_of
from src.core.pagination import Page, envelope, parse_uuid
from src.core.vocabulary import EMAIL_FOLDER, EMAIL_PRIORITY
from src.models.content import EmailAttachment, EmailMessage, EmailTemplate, EmailThread

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


# ── Reading ──────────────────────────────────────────────────────────────


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


# ── Writing ──────────────────────────────────────────────────────────────


def update_thread(session, thread_id: Any, payload: dict[str, Any], *, principal):
    """Star it, flag it, label it, or move it to another folder."""
    row = _thread_row(session, thread_id, principal)
    data = payload if isinstance(payload, dict) else {}
    before = {"folder": row.folder, "labels": list(row.labels or [])}

    if "is_starred" in data:
        row.is_starred = bool(data["is_starred"])
    if "is_important" in data:
        row.is_important = bool(data["is_important"])
    if "labels" in data:
        row.labels = _validated_labels(data["labels"])
    if "folder" in data:
        row.folder = _movable(data["folder"])
        # The messages follow the thread. A thread in ARCHIVE whose messages
        # still say INBOX is a mailbox whose two halves disagree, and every
        # count computed from either one is then somebody's bug report.
        for message in row.messages:
            message.folder = row.folder
    if "is_read" in data:
        stamp = now()
        read = bool(data["is_read"])
        for message in row.messages:
            message.is_read = read
            message.read_at = stamp if read else None
        _recount(session, row)

    session.flush()
    if before["folder"] != row.folder:
        audit.record(
            session,
            action="mail.move",
            resource_type="email_thread",
            resource_id=row.id,
            resource_label=row.subject,
            principal=principal,
            before=before,
            after={"folder": row.folder, "labels": list(row.labels or [])},
            # Not in the activity feed: where somebody files their own mail is
            # nobody else's business, and a feed of it would drown everything
            # that is (§35).
            activity=False,
        )
    return _thread(row)


def bulk(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """One action, applied to the threads somebody selected.

    Its own endpoint rather than a loop of `PUT`s in the browser: fifty
    round trips for one gesture, each able to fail on its own, is a bulk
    action that leaves the list in a state nobody chose.
    """
    me = _me(principal)
    data = payload if isinstance(payload, dict) else {}
    ids = [parse_uuid(item, field="ids") for item in (data.get("ids") or [])]
    if not ids:
        raise ValidationError("Choose some threads first.")
    if len(ids) > 500:
        raise ValidationError("At most 500 threads at a time.")

    action = str(data.get("action") or "").strip().upper()
    rows = session.scalars(_owned(me).where(EmailThread.id.in_(ids))).unique().all()
    # Silently ignoring the ones that are not this reader's would be the same
    # disclosure as saying which: the count is what comes back.
    stamp = now()

    for row in rows:
        if action == "READ" or action == "UNREAD":
            read = action == "READ"
            for message in row.messages:
                message.is_read = read
                message.read_at = stamp if read else None
            _recount(session, row)
        elif action == "STAR" or action == "UNSTAR":
            row.is_starred = action == "STAR"
        elif action == "MOVE":
            row.folder = _movable(data.get("folder"))
            for message in row.messages:
                message.folder = row.folder
        elif action == "LABEL":
            label = _one_label(data.get("label"))
            row.labels = sorted({*(row.labels or []), label})
        elif action == "UNLABEL":
            label = _one_label(data.get("label"))
            row.labels = [item for item in (row.labels or []) if item != label] or None
        else:
            raise ValidationError(
                "Unknown bulk action.",
                details={
                    "action": action,
                    "allowed": ["READ", "UNREAD", "STAR", "UNSTAR", "MOVE", "LABEL", "UNLABEL"],
                },
            )

    session.flush()
    audit.record(
        session,
        action="mail.bulk",
        resource_type="email_thread",
        resource_id=None,
        resource_label=f"{len(rows)} thread(s)",
        principal=principal,
        metadata={"action": action, "count": len(rows)},
        message=f"{action.lower()} on {len(rows)} thread(s)",
        activity=False,
    )
    return {"changed": len(rows), "action": action}


def remove_thread(session, thread_id: Any, *, principal) -> dict[str, Any]:
    """Bin it, or — if it is already in the bin — delete it for good.

    Two steps on purpose. A single irreversible delete on a mail client is the
    one gesture people most often regret, and a bin that a second press empties
    needs no confirmation dialog to be safe.
    """
    row = _thread_row(session, thread_id, principal)
    if row.folder != "TRASH":
        row.folder = "TRASH"
        for message in row.messages:
            message.folder = "TRASH"
        session.flush()
        return {"deleted": False, "folder": "TRASH", "id": str(row.id)}

    row.deleted_at = now()
    for message in row.messages:
        message.deleted_at = row.deleted_at
    session.flush()
    audit.record(
        session,
        action="mail.delete",
        resource_type="email_thread",
        resource_id=row.id,
        resource_label=row.subject,
        principal=principal,
        activity=False,
    )
    return {"deleted": True, "folder": "TRASH", "id": str(row.id)}


def compose(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Write a new message — as a draft, or queued to go.

    A reply carries `thread_id` and joins that conversation; anything else
    starts one. The thread is the same table either way, which is why a reply
    is not a different endpoint.
    """
    me = _me(principal)
    data = payload if isinstance(payload, dict) else {}
    values = _validated_message(session, data)
    send = bool(data.get("send"))

    parent = None
    if data.get("thread_id"):
        parent = _thread_row(session, data["thread_id"], principal)

    subject = values["subject"] or (f"Re: {parent.subject}" if parent else "")
    if not subject:
        raise ValidationError("A message needs a subject.")

    if parent is None:
        parent = EmailThread(
            subject=subject,
            folder="DRAFTS" if not send else "OUTBOX",
            owner_id=me,
            organization_id=getattr(principal, "organization_id", None),
            created_at=now(),
        )
        session.add(parent)
        session.flush()

    message = EmailMessage(
        thread_id=parent.id,
        message_ref=_next_ref(session),
        subject=subject[:MAX_SUBJECT],
        from_name=getattr(principal, "full_name", None) or "Somebody",
        from_email=getattr(principal, "email", None) or "somebody@nucleus.local",
        to_recipients=values["to"],
        cc_recipients=values["cc"] or None,
        bcc_recipients=values["bcc"] or None,
        body_text=values["body"],
        body_html=_as_html(values["body"]),
        preview=values["body"][:400] or None,
        # OUTBOX and not SENT: nothing has transported it, and the folder is
        # the whole claim this row makes.
        folder="OUTBOX" if send else "DRAFTS",
        is_read=True,
        is_draft=not send,
        priority=values["priority"],
        sender_id=me,
        owner_id=me,
        sent_at=now() if send else None,
        created_at=now(),
    )
    session.add(message)
    session.flush()

    # A reply moves the conversation to where the reply now lives, so a thread
    # somebody answered is not still sitting in Drafts.
    if send and parent.folder in ("DRAFTS", "INBOX"):
        parent.folder = "OUTBOX"
        for item in parent.messages:
            if item.is_draft:
                continue
            item.folder = "OUTBOX"

    _recount(session, parent)
    audit.record(
        session,
        action="mail.send" if send else "mail.draft",
        resource_type="email_message",
        resource_id=message.id,
        resource_label=subject,
        principal=principal,
        after={"folder": message.folder, "to": values["to"]},
        activity=False,
    )
    return _thread(parent, messages=True)


def update_message(session, message_id: Any, payload: dict[str, Any], *, principal):
    """Edit a draft, or send it.

    Only a draft. A message that has been queued or received is a record of
    something that happened, and an editable one is a mailbox whose history
    cannot be trusted.
    """
    row = _message_row(session, message_id, principal)
    if not row.is_draft:
        raise ForbiddenError("Only a draft can be edited.")

    data = payload if isinstance(payload, dict) else {}
    values = _validated_message(session, data, partial=True)
    for name, column in (("subject", "subject"), ("body", "body_text"), ("priority", "priority")):
        if name in values:
            setattr(row, column, values[name])
    if "body" in values:
        row.body_html = _as_html(values["body"])
        row.preview = values["body"][:400] or None
    for name, column in (("to", "to_recipients"), ("cc", "cc_recipients"), ("bcc", "bcc_recipients")):
        if name in values:
            setattr(row, column, values[name] or None)

    if bool(data.get("send")):
        if not row.to_recipients:
            raise ValidationError("A message needs at least one recipient before it goes.")
        row.is_draft = False
        row.folder = "OUTBOX"
        row.sent_at = now()
        parent = row.thread
        if parent is not None:
            parent.folder = "OUTBOX"

    session.flush()
    parent = row.thread
    if parent is not None:
        if row.subject and parent.message_count == 1:
            parent.subject = row.subject
        _recount(session, parent)
    audit.record(
        session,
        action="mail.send" if not row.is_draft else "mail.draft",
        resource_type="email_message",
        resource_id=row.id,
        resource_label=row.subject,
        principal=principal,
        activity=False,
    )
    return _thread(parent, messages=True) if parent is not None else _message(row)


def remove_message(session, message_id: Any, *, principal) -> dict[str, Any]:
    """Discard a draft. Only a draft — see `update_message`."""
    row = _message_row(session, message_id, principal)
    if not row.is_draft:
        raise ForbiddenError("Only a draft can be discarded.")
    parent = row.thread
    row.deleted_at = now()
    session.flush()
    if parent is not None:
        _recount(session, parent)
        # A thread whose only message was the draft is not a conversation.
        if parent.message_count == 0:
            parent.deleted_at = row.deleted_at
            session.flush()
    return {"deleted": True, "id": str(row.id)}


def templates(session, *, principal) -> dict[str, Any]:
    """The composer's wording, from the templates an administrator maintains.

    Read here rather than from `/admin/email-templates`, which is privileged:
    somebody with a mailbox should be able to use a template without being
    able to edit one (§11, §16).
    """
    _me(principal)
    rows = session.scalars(
        select(EmailTemplate)
        .where(EmailTemplate.is_active.is_(True), EmailTemplate.deleted_at.is_(None))
        .order_by(EmailTemplate.category, EmailTemplate.name)
    ).all()
    return {
        "items": [
            {
                "code": row.code,
                "name": row.name,
                "description": row.description,
                "category": row.category,
                "subject": row.subject,
                "body": row.body_text or _as_text(row.body_html),
                "variables": list(row.variables or []),
            }
            for row in rows
        ],
        "total": len(rows),
    }


def render_template(session, code: str, values: dict[str, Any], *, principal):
    """Fill a template's placeholders, on the server.

    Here and not in the browser because the *substitution rule* is a fact
    about a template: `{{ name }}` and `{{name}}` are the same placeholder, an
    unknown one is left alone rather than blanked, and a second implementation
    would disagree about both the first time somebody wrote a space.
    """
    _me(principal)
    return _rendered(_template_row(session, code), values)


def _template_row(session, code: str) -> EmailTemplate:
    row = session.scalar(
        select(EmailTemplate).where(
            EmailTemplate.code == str(code or ""), EmailTemplate.deleted_at.is_(None)
        )
    )
    if row is None:
        raise NotFoundError("That template does not exist.")
    return row


def _rendered(row: EmailTemplate, values: dict[str, Any] | None) -> dict[str, Any]:
    """The substitution itself, with no permission check.

    Separate from `render_template` so the composer can use a template without
    this module needing a stand-in principal to satisfy its own endpoint — the
    caller has checked `mail.access` already, and re-checking it for somebody
    who has just used it is a check that only ever fails by accident.
    """
    known = {str(key): str(value) for key, value in (values or {}).items()}

    def fill(text: str | None) -> str:
        return _PLACEHOLDER.sub(lambda hit: known.get(hit.group(1), hit.group(0)), text or "")

    body = row.body_text or _as_text(row.body_html)
    return {
        "code": row.code,
        "subject": fill(row.subject),
        "body": fill(body),
        # Which placeholders were not supplied, so the composer can say so
        # before somebody sends "Dear {{ name }}" to a customer (§76).
        "unfilled": sorted(
            {
                hit
                for text in (row.subject, body)
                for hit in _PLACEHOLDER.findall(text)
                if hit not in known
            }
        ),
    }


# ── Validation ───────────────────────────────────────────────────────────


def _validated_message(
    session, data: dict[str, Any], *, partial: bool = False
) -> dict[str, Any]:
    values: dict[str, Any] = {}

    if "subject" in data or not partial:
        values["subject"] = str(data.get("subject") or "").strip()[:MAX_SUBJECT]
    if "body" in data or not partial:
        body = str(data.get("body") or "")
        if len(body) > MAX_BODY:
            raise ValidationError("That message is too long to store.")
        values["body"] = body
    if "priority" in data or not partial:
        priority = str(data.get("priority") or "NORMAL").upper()
        if priority not in EMAIL_PRIORITY:
            raise ValidationError(
                "Unknown priority.",
                details={"priority": priority, "allowed": list(EMAIL_PRIORITY)},
            )
        values["priority"] = priority

    # All three on a full write, so `compose` reads a complete shape. Only the
    # ones given on a partial one, so editing a draft's subject does not
    # silently empty its cc list.
    for field in ("to", "cc", "bcc"):
        if field in data or not partial:
            values[field] = _validated_recipients(data.get(field), field)

    # A draft with no recipient is normal — that is what a draft is for. The
    # requirement belongs at the moment of sending, and on a *partial* write
    # it belongs to the row rather than to the payload: `PUT {"send": true}`
    # on a draft that already has recipients names none of its own, and
    # reading the payload refused to send a perfectly complete message.
    # `update_message` makes that check against the row it just wrote.
    if not partial and data.get("send") and not values.get("to"):
        raise ValidationError("A message needs at least one recipient before it goes.")

    # A template supplies whatever the composer left blank, and never
    # overwrites what somebody typed: a template that replaced an edited
    # subject would be a template nobody dares pick twice.
    if data.get("template"):
        filled = _rendered(_template_row(session, str(data["template"])), data.get("variables"))
        if not values.get("subject"):
            values["subject"] = filled["subject"]
        if not values.get("body"):
            values["body"] = filled["body"]

    return values


def _validated_recipients(raw: Any, field: str) -> list[dict[str, str]]:
    """`["a@b.c"]` or `[{name, email}]` → one shape, with the addresses checked.

    Validated here because a malformed address is worth refusing at the moment
    somebody can still fix it — and because the stored shape is what every
    screen reads: two accepted spellings would be two renderings of a
    recipient list.
    """
    if raw in (None, ""):
        return []
    items = raw if isinstance(raw, list) else [raw]
    if len(items) > MAX_RECIPIENTS:
        raise ValidationError(f"At most {MAX_RECIPIENTS} addresses in {field}.")

    cleaned: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in items:
        if isinstance(item, str):
            item = {"email": item}
        if not isinstance(item, dict):
            raise ValidationError(f"each entry in {field} must be an address")
        email = str(item.get("email") or "").strip().lower()
        if not _EMAIL.match(email):
            raise ValidationError(
                f"{email or '(empty)'} is not an email address.", details={"field": field}
            )
        if email in seen:
            continue
        seen.add(email)
        cleaned.append({"name": str(item.get("name") or "").strip()[:160], "email": email})
    return cleaned


def _validated_labels(raw: Any) -> list[str] | None:
    if raw in (None, [], ""):
        return None
    if not isinstance(raw, list):
        raise ValidationError("labels must be a list")
    labels = sorted({str(item).strip()[:48] for item in raw if str(item).strip()})
    if len(labels) > MAX_LABELS:
        raise ValidationError(f"A thread takes at most {MAX_LABELS} labels.")
    return labels or None


def _one_label(raw: Any) -> str:
    label = str(raw or "").strip()[:48]
    if not label:
        raise ValidationError("That action needs a label.")
    return label


def _folder(raw: Any, *, default: str) -> str:
    folder = str(raw or default).strip().upper()
    if folder not in EMAIL_FOLDER:
        raise ValidationError(
            "Unknown folder.", details={"folder": folder, "allowed": list(EMAIL_FOLDER)}
        )
    return folder


def _movable(raw: Any) -> str:
    """A folder a person may file a thread into.

    `SENT` and `OUTBOX` are the platform's own: letting somebody file an
    inbound message into `SENT` would make the folder mean nothing, and every
    count and report reading it would then be describing a fiction.
    """
    folder = _folder(raw, default="INBOX")
    if folder not in MOVABLE:
        raise ValidationError(
            f"A thread cannot be moved to {folder}.",
            details={"folder": folder, "allowed": list(MOVABLE)},
        )
    return folder


# ── Rows ─────────────────────────────────────────────────────────────────


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


# ── Serialisation ────────────────────────────────────────────────────────


def _thread(row: EmailThread, *, messages: bool = False) -> dict[str, Any]:
    people = [
        {**entry, "initials": initials(str(entry.get("name") or entry.get("email") or ""))}
        for entry in (row.participants or [])
        if isinstance(entry, dict)
    ]
    detail: dict[str, Any] = {
        "id": str(row.id),
        "subject": row.subject,
        "folder": row.folder,
        "message_count": int(row.message_count or 0),
        "unread_count": int(row.unread_count or 0),
        "has_attachments": bool(row.has_attachments),
        "is_starred": bool(row.is_starred),
        "is_important": bool(row.is_important),
        "labels": list(row.labels or []),
        "last_message_at": iso(row.last_message_at),
        "participants": people,
        "snippet": row.snippet,
        "created_at": iso(row.created_at),
        # Whether the reader can still edit anything in it: a thread with a
        # draft in it has an unfinished message, which is what the list badge
        # means (§76).
        "has_draft": any(item.is_draft and item.deleted_at is None for item in row.messages),
    }
    if messages:
        detail["messages"] = [
            _message(item)
            for item in sorted(
                (item for item in row.messages if item.deleted_at is None),
                key=lambda item: (item.sent_at or item.created_at),
            )
        ]
    return detail


def _message(row: EmailMessage) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "thread_id": str(row.thread_id) if row.thread_id else None,
        "reference": row.message_ref,
        "subject": row.subject,
        "from": {
            "name": row.from_name,
            "email": row.from_email,
            "initials": initials(row.from_name or row.from_email),
        },
        "to": list(row.to_recipients or []),
        "cc": list(row.cc_recipients or []),
        "bcc": list(row.bcc_recipients or []),
        "body": row.body_text or _as_text(row.body_html),
        "preview": row.preview,
        "folder": row.folder,
        "is_read": bool(row.is_read),
        "is_starred": bool(row.is_starred),
        "is_draft": bool(row.is_draft),
        "priority": row.priority,
        "sent_at": iso(row.sent_at),
        "read_at": iso(row.read_at),
        "attachment_count": int(row.attachment_count or 0),
        "attachments": [
            {
                "id": str(item.id),
                "name": item.name,
                "mime_type": item.mime_type,
                "size_bytes": int(item.size_bytes or 0),
                "file_id": str(item.file_id) if item.file_id else None,
            }
            for item in row.attachments
            if isinstance(item, EmailAttachment)
        ],
    }


def _as_html(body: str) -> str:
    """Plain text as the paragraphs it was written as.

    Escaped first. The composer stores what somebody typed and this is the
    rendering; treating it as markup would make a mailbox a place to inject
    script into a colleague's browser.
    """
    from html import escape

    paragraphs = [escape(part).replace("\n", "<br>") for part in body.split("\n\n") if part.strip()]
    return "".join(f"<p>{part}</p>" for part in paragraphs)


def _as_text(html: str | None) -> str:
    """The words out of a stored HTML body, for a plain-text reader."""
    if not html:
        return ""
    text = re.sub(r"</p\s*>", "\n\n", html, flags=re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    return re.sub(r"<[^>]+>", "", text).strip()


def _next_ref(session) -> str:
    """`<MAIL-000042@nucleus.local>` — unique, and obviously ours."""
    latest = session.scalar(
        select(func.max(EmailMessage.message_ref)).where(
            EmailMessage.message_ref.like("<MAIL-%")
        )
    )
    number = sequence_of((latest or "").strip("<>").split("@")[0], prefix="MAIL") + 1
    return f"<{identifier('MAIL', number, width=6)}@nucleus.local>"
