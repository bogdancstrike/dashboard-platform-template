"""Listing, creating, changing, removing and duplicating documents."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core import audit, sharing
from src.core.clock import now
from src.models.personal import ReportDocument
from src.services.analytics.report_documents.serializers import (
    _copy_name,
    _owned,
    _serialize,
    _slug,
    _state,
    _visible,
)
from src.services.analytics.report_documents.validation import _validated
from src.services.analytics.report_documents.vocabulary import (
    BLOCK_KINDS,
    DEFAULT_PAGE,
    FORMATS,
    KIND,
    MANAGE_PERMISSION,
    PAGE_SIZES,
    SHARE_PERMISSION,
    STARTER_BLOCKS,
    VIEW_PERMISSION,
)
from src.services.records import explorer


def listing(session, *, principal) -> dict[str, Any]:
    """Every document this reader may open, their own first."""
    principal.require(VIEW_PERMISSION)
    rows = session.scalars(
        select(ReportDocument)
        .options(selectinload(ReportDocument.owner))
        .where(
            ReportDocument.deleted_at.is_(None),
            sharing.visibility(ReportDocument, KIND, principal),
        )
        .order_by(ReportDocument.updated_at.desc(), ReportDocument.name.asc())
    ).unique().all()

    sharing.prefetch_members(session, KIND, [row.id for row in rows])
    return {
        "items": [_serialize(session, row, principal, blocks=False) for row in rows],
        "total": len(rows),
        "block_kinds": sorted(BLOCK_KINDS),
        "formats": sorted(FORMATS),
        "page_sizes": sorted(PAGE_SIZES),
        "defaults": dict(DEFAULT_PAGE),
        # Only the datasets this reader may read, so a table block cannot be
        # pointed at one that would render as a refusal.
        "datasets": [
            {"key": resource.key, "label": resource.label, "path": resource.path}
            for resource in explorer.resources().values()
            if principal.can(resource.permission)
        ],
        "can_create": principal.can(MANAGE_PERMISSION),
        "can_share": principal.can(SHARE_PERMISSION),
    }


def get(session, document_id: Any, *, principal) -> dict[str, Any]:
    return _serialize(session, _visible(session, document_id, principal), principal)


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    values = _validated(payload, principal=principal, partial=False)
    members = values.pop("member_ids")

    row = ReportDocument(
        owner_id=principal.user_id,
        organization_id=principal.organization_id,
        slug=_slug(values["name"]),
        **values,
    )
    # Only when the caller said nothing at all: a create that carried blocks
    # means somebody already composed something, and overwriting it with a
    # starter would be the builder deciding it knew better.
    if row.blocks is None:
        row.blocks = [dict(block) for block in STARTER_BLOCKS]
    if row.page is None:
        row.page = dict(DEFAULT_PAGE)

    session.add(row)
    session.flush()
    sharing.replace_members(
        session, KIND, row.id, members, principal=principal, owner_id=row.owner_id,
    )
    audit.record(
        session, action="CREATE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal, after=_state(row),
        message=f"created report document {row.name}", activity=False,
    )
    return _serialize(session, row, principal)


def update(session, document_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    row = _owned(session, document_id, principal)
    values = _validated(payload, principal=principal, partial=True, existing=row)
    members = values.pop("member_ids", None)
    before = _state(row)

    for key, value in values.items():
        setattr(row, key, value)
    if members is not None:
        sharing.replace_members(
            session, KIND, row.id, members, principal=principal, owner_id=row.owner_id,
        )
    session.flush()
    audit.record(
        session,
        action="SHARE" if "scope" in values or members is not None else "UPDATE",
        resource_type=KIND, resource_id=row.id, resource_label=row.name,
        principal=principal, before=before, after=_state(row),
        message=f"updated report document {row.name}", activity=False,
    )
    return _serialize(session, row, principal)


def remove(session, document_id: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    row = _owned(session, document_id, principal)
    before = _state(row)
    row.deleted_at = now()
    audit.record(
        session, action="DELETE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal, before=before,
        message=f"deleted report document {row.name}", activity=False,
    )
    return {"id": str(row.id), "deleted": True, "name": row.name}


def duplicate(session, document_id: Any, *, principal) -> dict[str, Any]:
    """A private copy, owned by whoever asked — the template pattern.

    A document is the closest thing this platform has to a template: the
    quarterly review is the same six blocks with a different period every time.
    Copying is how that works, and the copy shares nothing, because inheriting
    the original's audience would publish an unfinished draft to its members.
    """
    principal.require(MANAGE_PERMISSION)
    source = _visible(session, document_id, principal)
    row = ReportDocument(
        owner_id=principal.user_id,
        organization_id=principal.organization_id,
        name=_copy_name(session, source.name, principal),
        slug=_slug(source.name),
        description=source.description,
        scope="PRIVATE",
        page=dict(source.page or DEFAULT_PAGE),
        blocks=[dict(block) for block in (source.blocks or [])],
    )
    session.add(row)
    session.flush()
    audit.record(
        session, action="CREATE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal, after=_state(row),
        message=f"copied report document {source.name}", activity=False,
    )
    return _serialize(session, row, principal)
