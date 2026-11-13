"""One entry, and a record's timeline."""

from __future__ import annotations

from typing import Any

from sqlalchemy import tuple_

from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.core.query import count_of
from src.core.repository import get_or_404
from src.services.platform.audit.ledger import (
    LEDGER_PERMISSION,
    MAX_TIMELINE,
    TIMELINE_PERMISSION,
    _statement,
)
from src.services.platform.audit.serializers import detail


def entry(session, entry_id: Any, *, principal) -> dict[str, Any]:
    """One entry, with the diff and the request context behind it."""
    principal.require(LEDGER_PERMISSION)
    from src.models.platform import AuditLog

    identifier = parse_uuid(entry_id, field="entry_id")
    row = get_or_404(session, AuditLog, identifier, "That audit entry does not exist.")
    return detail(row)


def timeline(session, args, *, principal) -> dict[str, Any]:
    """Every recorded action against one record — or through it, newest first
    (§21, §48).

    Scoped to a resource on purpose: this is the panel an entity detail page
    shows, and an endpoint that accepts "no resource" would quietly be the
    whole ledger behind a lesser permission.

    **`thread=true` widens it to the records this one is joined to**, which is
    the cross-record timeline: a ticket's own history says when its severity
    changed, and the *thread* says that the account it was filed against was
    edited an hour earlier and an order of theirs was refunded the day before.
    That is usually the actual story, and reading it otherwise means opening
    four history tabs and merging them by eye.

    The neighbours come from `services/relationships`, which derives them from
    the foreign keys the schema already declares and drops the datasets this
    reader may not see — so widening the timeline can never widen what they
    are allowed to know. It is bounded: the relationship sample per group is
    what stops "everything touching this organization" from being the ledger.
    """
    principal.require(TIMELINE_PERMISSION)
    from src.models.platform import AuditLog

    resource_type = str(args.get("resource_type") or "").strip()
    resource_id = str(args.get("resource_id") or "").strip()
    if not resource_type or not resource_id:
        raise ValidationError(
            "A timeline needs both resource_type and resource_id.",
            details={"resource_type": resource_type, "resource_id": resource_id},
        )

    try:
        limit = int(args.get("limit", 50))
    except (TypeError, ValueError) as exc:
        raise ValidationError("limit must be an integer") from exc
    if limit < 1 or limit > MAX_TIMELINE:
        raise ValidationError(f"limit must be between 1 and {MAX_TIMELINE}")

    wanted = _truthy(args.get("thread"))
    subjects = [{"resource_type": resource_type, "resource_id": resource_id, "label": ""}]
    if wanted:
        subjects.extend(_neighbours(session, resource_type, resource_id, principal=principal))

    keys = {(item["resource_type"], item["resource_id"]) for item in subjects}
    statement = (
        _statement()
        .where(
            tuple_(AuditLog.resource_type, AuditLog.resource_id).in_(sorted(keys)),
        )
        .order_by(AuditLog.occurred_at.desc())
    )
    total = count_of(session, statement)
    rows = session.scalars(statement.limit(limit)).all()

    return {
        "items": [detail(row) for row in rows],
        "total": total,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "limit": limit,
        # What the thread covers, so the page can say whose history it is
        # merging rather than showing entries from records nobody named.
        "thread": wanted,
        "subjects": subjects,
    }


def _neighbours(session, resource_type: str, resource_id: str, *, principal) -> list[dict[str, Any]]:
    """The records this one is joined to, as timeline subjects.

    Read through the relationship graph rather than by walking foreign keys
    here: that module already knows which datasets this reader may see, and a
    second implementation of "what is this joined to" would eventually widen a
    timeline past what the reader may know.

    A record with no graph — a dataset the relationship module does not model —
    is not an error: the thread is then the record's own history, which is what
    it was before.
    """
    from src.services.records import relationships

    try:
        graph = relationships.graph(session, resource_type, resource_id, principal=principal)
    except (ValidationError, NotFoundError):
        return []

    out: list[dict[str, Any]] = []
    seen = {(resource_type, str(resource_id))}
    for group in graph.get("groups", []):
        for item in group.get("items", []):
            key = (str(item.get("entity") or ""), str(item.get("id") or ""))
            if not key[0] or not key[1] or key in seen:
                continue
            seen.add(key)
            out.append({
                "resource_type": key[0],
                "resource_id": key[1],
                "label": str(item.get("label") or ""),
            })
    return out


def _truthy(value: Any) -> bool:
    """A query-string flag, read the way every other one here is."""
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}
