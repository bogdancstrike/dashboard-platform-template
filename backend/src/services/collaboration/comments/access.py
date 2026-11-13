"""Who may read or write a thread, and the record a comment hangs on."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core.errors import ForbiddenError, NotFoundError
from src.core.pagination import parse_uuid
from src.models.content import Comment
from src.services.collaboration.comments.targets import (
    _RECORD_PATHS,
    COMMENTABLE,
    WRITE_PERMISSION,
    Commentable,
)
from src.services.records.explorer import resource_for


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


def _may_write(resource, principal) -> bool:
    if isinstance(resource, Commentable):
        return principal.can(resource.permission)
    return principal.can(WRITE_PERMISSION)


def _resource_of(row: Comment, principal):
    special = COMMENTABLE.get(row.resource_type)
    if special is not None:
        return special
    return resource_for(row.resource_type, principal=principal)


def _link_for(resource, record_id) -> str:
    if isinstance(resource, Commentable):
        return resource.link(record_id) if resource.link else ""
    return f"{_RECORD_PATHS.get(resource.key, '/explore')}/{record_id}"
