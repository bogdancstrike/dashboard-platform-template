"""Changing, refreshing and removing insights."""

from __future__ import annotations

from typing import Any

from src.core import audit, sharing
from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.services.analytics.insights import spec as specs
from src.services.analytics.insights.pages.library import _row, detail
from src.services.analytics.insights.pages.tools import (
    KIND,
    SHARE_PERMISSION,
    USE_PERMISSION,
)


def update(session, ident: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(USE_PERMISSION)
    row = _row(session, ident, principal)
    sharing.require_owner(row, principal, kind="insight")
    payload = payload if isinstance(payload, dict) else {}
    before = {"title": row.title, "scope": row.scope, "pinned": row.pinned}
    if "title" in payload:
        title = str(payload.get("title") or "").strip()[:200]
        if not title:
            raise ValidationError("An insight needs a title.", details={"field": "title"})
        row.title = title
        row.spec = {**row.spec, "title": title}
    if "pinned" in payload:
        row.pinned = bool(payload.get("pinned"))
    if "scope" in payload:
        row.scope = sharing.scope_of(payload.get("scope"), current=row.scope, principal=principal,
                                     share_permission=SHARE_PERMISSION)
    if "member_ids" in payload:
        sharing.replace_members(session, KIND, row.id, sharing.requested_members(payload),
                                principal=principal, owner_id=row.owner_id)
    session.flush()
    audit.record(session, action="UPDATE", resource_type="insight", resource_id=row.id, resource_label=row.title,
                 principal=principal, before=before,
                 after={"title": row.title, "scope": row.scope, "pinned": row.pinned},
                 message=f"updated insight {row.title}", activity=False)
    return detail(session, row.id, principal=principal)


def refresh(session, ident: Any, *, principal) -> dict[str, Any]:
    """Re-run the queries and keep the new numbers. The model is not asked."""
    principal.require(USE_PERMISSION)
    row = _row(session, ident, principal)
    rendered, errors = specs.bind(session, row.spec, principal=principal)
    if row.owner_id == principal.user_id:
        row.rendered = rendered
        row.warnings = errors or None
        row.refreshed_at = now()
        session.flush()
        return detail(session, row.id, principal=principal)
    # A reader who is not the owner sees fresh numbers without rewriting the
    # owner's copy with what *they* may see.
    return {**detail(session, row.id, principal=principal), "rendered": rendered, "warnings": errors,
            "refreshed_at": iso(now())}


def remove(session, ident: Any, *, principal) -> dict[str, Any]:
    principal.require(USE_PERMISSION)
    row = _row(session, ident, principal)
    sharing.require_owner(row, principal, kind="insight")
    row.deleted_at = now()
    session.flush()
    audit.record(session, action="DELETE", resource_type="insight", resource_id=row.id, resource_label=row.title,
                 principal=principal, before={"title": row.title}, message=f"removed insight {row.title}")
    return {"id": str(row.id), "deleted": True}
