"""Composing and editing messages."""

from __future__ import annotations

from typing import Any

from src.core import audit
from src.core.clock import now
from src.core.errors import ForbiddenError, ValidationError
from src.models.content import EmailMessage, EmailThread
from src.services.collaboration.mail.rows import (
    MAX_SUBJECT,
    _me,
    _message_row,
    _recount,
    _thread_row,
)
from src.services.collaboration.mail.serializers import (
    _as_html,
    _message,
    _next_ref,
    _thread,
)
from src.services.collaboration.mail.validation import _validated_message


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
