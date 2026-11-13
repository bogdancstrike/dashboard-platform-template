"""A comment's body, parent, mentions and attachments, checked."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.models.content import Comment
from src.services.collaboration.comments.targets import (
    _MENTION,
    MAX_ATTACHMENTS,
    MAX_BODY,
)


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
