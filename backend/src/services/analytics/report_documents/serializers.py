"""Who sees a document, and a document as the API returns it."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core import sharing
from src.core.errors import NotFoundError
from src.core.pagination import parse_uuid
from src.models.personal import ReportDocument
from src.services.analytics.report_documents.vocabulary import (
    DEFAULT_PAGE,
    KIND,
    MANAGE_PERMISSION,
    VIEW_PERMISSION,
)


def _visible(session, document_id: Any, principal) -> ReportDocument:
    principal.require(VIEW_PERMISSION)
    identifier = parse_uuid(document_id, field="document_id")
    row = session.scalars(
        select(ReportDocument)
        .options(selectinload(ReportDocument.owner))
        .where(
            ReportDocument.id == identifier,
            ReportDocument.deleted_at.is_(None),
            sharing.visibility(ReportDocument, KIND, principal),
        )
    ).unique().first()
    if row is None:
        # The same answer as "you may not see it": whether somebody else's
        # private document exists is itself information (§76).
        raise NotFoundError("That document does not exist.", details={"id": str(identifier)})
    return row


def _owned(session, document_id: Any, principal) -> ReportDocument:
    row = _visible(session, document_id, principal)
    sharing.require_owner(row, principal, kind=KIND)
    return row


def _period_label(period: str) -> str:
    """The window, written the way a cover page would say it."""
    return str(period).replace("_", " ").replace("last ", "The last ").strip().capitalize()


def _copy_name(session, name: str, principal) -> str:
    taken = set(session.scalars(
        select(ReportDocument.name).where(
            ReportDocument.owner_id == principal.user_id,
            ReportDocument.deleted_at.is_(None),
        )
    ).all())
    if name not in taken:
        return name[:200]
    for suffix in range(2, 100):
        candidate = f"{name} ({suffix})"[:200]
        if candidate not in taken:
            return candidate
    return f"{name} (copy)"[:200]


def _slug(name: str) -> str:
    cleaned = "".join(character if character.isalnum() else "-" for character in name.lower())
    return "-".join(part for part in cleaned.split("-") if part)[:120] or "document"


def _serialize(
    session, row: ReportDocument, principal, *, blocks: bool = True
) -> dict[str, Any]:
    owner = row.owner
    can_edit = row.owner_id == principal.user_id and principal.can(MANAGE_PERMISSION)
    out: dict[str, Any] = {
        "id": str(row.id),
        "name": row.name,
        "slug": row.slug,
        "description": row.description,
        "scope": row.scope,
        "page": {**DEFAULT_PAGE, **(row.page or {})},
        "owner": {
            "id": str(owner.id) if owner else "",
            "name": owner.full_name if owner else "",
            "email": owner.email if owner else None,
        },
        "can_edit": can_edit,
        "members": sharing.members(session, KIND, row.id) if can_edit else [],
        "block_count": len(row.blocks or []),
        # *What* it holds, so a card in a gallery says more than a number — the
        # same reason a dashboard card lists its widget kinds.
        "block_kinds": sorted({str(block.get("kind")) for block in (row.blocks or [])}),
        "render_count": int(row.render_count or 0),
        "last_rendered_at": row.last_rendered_at.isoformat() if row.last_rendered_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
    if blocks:
        out["blocks"] = [dict(block) for block in (row.blocks or [])]
    return out


def _state(row: ReportDocument) -> dict[str, Any]:
    return {
        "name": row.name,
        "scope": row.scope,
        "blocks": len(row.blocks or []),
        "page": dict(row.page or {}),
    }
