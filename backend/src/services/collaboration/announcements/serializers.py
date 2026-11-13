"""Announcements as the API returns them, and who sees one."""

from __future__ import annotations

from typing import Any

from src.core.clock import iso


def _state(row) -> dict[str, Any]:
    """What the audit trail records about a notice.

    A projection rather than the validated payload: the payload holds
    `datetime` and `UUID` objects, and the whole state goes into a JSONB
    column. `core/audit.jsonable` now coerces those centrally — this stays a
    projection because the *diff* should read as the decisions somebody made,
    not as every column of the row.
    """
    return {
        "title": row.title,
        "category": row.category,
        "severity": row.severity,
        "status": row.status,
        "publish_at": iso(row.publish_at) if row.publish_at else None,
        "expires_at": iso(row.expires_at) if row.expires_at else None,
        "audience_roles": list(row.audience_roles or []),
        "requires_acknowledgement": bool(row.requires_acknowledgement),
        "is_pinned": bool(row.is_pinned),
    }


def _visible_to(row, principal, moment) -> bool:
    """Whether this notice is addressed to this reader, and live.

    The same rule the list applies, in Python, for the single-row paths. Two
    expressions of one rule is a risk, so the list's is the SQL translation of
    this and the tests assert they agree on a notice for another role.
    """
    if row.deleted_at is not None:
        return False
    if row.status != "PUBLISHED":
        return False
    if row.publish_at and row.publish_at > moment:
        return False
    if row.expires_at and row.expires_at <= moment:
        return False
    roles = list(row.audience_roles or [])
    if roles and (getattr(principal, "role_code", None) or "") not in roles:
        return False
    return row.organization_id in (None, principal.organization_id)
