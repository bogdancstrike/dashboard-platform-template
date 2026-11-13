"""Changing threads: flags, folders, labels, in bulk, removal."""

from __future__ import annotations

from typing import Any

from src.core import audit
from src.core.clock import now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.models.content import EmailThread
from src.services.collaboration.mail.rows import _me, _owned, _recount, _thread_row
from src.services.collaboration.mail.serializers import _thread
from src.services.collaboration.mail.validation import (
    _movable,
    _one_label,
    _validated_labels,
)


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
