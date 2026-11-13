"""Posting, editing and removing comments, reacting, and read and typing signals."""

from __future__ import annotations

from typing import Any

from src.core import audit
from src.core.clock import now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.models.content import Comment
from src.services.collaboration.comments.access import (
    _label,
    _own,
    _readable,
    _require_record,
    _resource_of,
    _target,
)
from src.services.collaboration.comments.content import (
    _attachments,
    _body,
    _mentioned,
    _parent,
)
from src.services.collaboration.comments.reading import _serialize
from src.services.collaboration.comments.signals import (
    _announce,
    _audited,
    _mark,
    _notify_mentions,
    _touch,
)
from src.services.collaboration.comments.targets import (
    COMMENTABLE,
    REACTIONS,
    WRITE_PERMISSION,
    Commentable,
)
from src.services.collaboration.comments.thread_facts import _names


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
