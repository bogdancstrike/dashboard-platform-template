"""Audit rows as the API returns them, with secrets masked."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from src.core.audit import MASK, is_secret


def summarise(row) -> dict[str, Any]:
    """A ledger row: who / when / what, at a glance.

    The diff is deliberately *not* here — a page of twenty-five rows would
    otherwise carry twenty-five before-and-after documents to render six
    columns. `changed_field_count` is what the list actually needs.
    """
    return {
        "id": str(row.id),
        "occurred_at": _json(row.occurred_at),
        "action": row.action,
        "result": row.result,
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "resource_label": row.resource_label or "",
        "actor_id": str(row.actor_id) if row.actor_id else None,
        "actor_label": row.actor_label or "System",
        "actor_role": row.actor_role or "",
        "impersonated": bool(row.impersonated),
        "impersonator_label": row.impersonator_label or "",
        "correlation_id": row.correlation_id or "",
        "message": row.message or "",
        "changed_field_count": len(row.changed_fields or []),
    }


def detail(row) -> dict[str, Any]:
    """One entry in full: the summary, the request context, and the diff.

    The diff is served as a list rather than an object so the order is the
    server's to choose and the client renders what it is given. A browser that
    re-derives a diff from two documents is a second implementation of
    `core/audit.diff`, and the two will disagree about something eventually.
    """
    return {
        **summarise(row),
        "ip_address": row.ip_address or "",
        "user_agent": row.user_agent or "",
        "organization_id": str(row.organization_id) if row.organization_id else None,
        "metadata": _mask(row.metadata_json),
        # Masked again on the way out, though `core/audit.record` already
        # masked on the way in (§76). Redacting in one place makes the property
        # true of one writer; redacting here makes it true of the endpoint, and
        # the endpoint is what a row written by a migration, a fixture or a
        # future second writer has to pass through.
        "state_before": _mask(row.state_before),
        "state_after": _mask(row.state_after),
        "changed_fields": list(row.changed_fields or []),
        "changes": [
            {
                "field": name,
                "from": MASK if is_secret(name) else _json(change.get("from")),
                "to": MASK if is_secret(name) else _json(change.get("to")),
                # "added" and "cleared" are different events and the drawer has
                # to be able to tell them apart (§21). Comparing two rendered
                # strings cannot: a field set to "" and a field removed both
                # render as nothing.
                "kind": _change_kind(change),
            }
            for name, change in sorted((row.changes or {}).items())
            if isinstance(change, dict)
        ],
    }


def _change_kind(change: dict[str, Any]) -> str:
    before, after = change.get("from"), change.get("to")
    if _absent(before) and not _absent(after):
        return "added"
    if not _absent(before) and _absent(after):
        return "cleared"
    return "changed"


def _mask(payload: Any) -> dict[str, Any]:
    """A stored JSON document, with secret-shaped keys blanked."""
    if not isinstance(payload, dict):
        return {}
    return {key: (MASK if is_secret(key) else _json(value)) for key, value in payload.items()}


def _absent(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def _json(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {key: _json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json(item) for item in value]
    return value
