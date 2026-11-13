"""Threads and messages as the API returns them."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import func, select

from src.core.clock import iso
from src.core.naming import identifier, initials, sequence_of
from src.models.content import EmailAttachment, EmailMessage, EmailThread


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
