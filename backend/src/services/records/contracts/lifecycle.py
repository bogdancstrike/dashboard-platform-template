"""Removing a contract, rescoring, its files folder, and catching up."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.clock import now
from src.services.records.contracts.fields import MANAGE, VIEW, _load


def remove(session, contract_id: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    row = _load(session, contract_id)
    row.deleted_at = now()
    audit.record(session, action="DELETE", resource_type="contract", resource_id=row.id,
                 resource_label=row.reference, principal=principal,
                 before={"deleted": False}, after={"deleted": True}, message=f"deleted contract {row.reference}")
    session.flush()
    _rescore(session, row.customer_id)
    return {"id": str(row.id), "deleted": True, "reference": row.reference}


def _rescore(session, customer_id) -> None:
    from src.services.records import customer_health

    customer_health.recompute(session, notify=True, customer_ids=[customer_id])


def files(session, contract_id: Any, *, principal) -> dict[str, Any]:
    from src.models.content import FileObject

    principal.require(VIEW)
    row = _load(session, contract_id)
    items = []
    if row.folder_id:
        for item in session.scalars(
            select(FileObject).where(FileObject.folder_id == row.folder_id, FileObject.deleted_at.is_(None))
            .order_by(FileObject.created_at.desc())
        ):
            items.append({
                "id": str(item.id), "name": item.name, "extension": item.extension, "kind": item.kind,
                "size_bytes": item.size_bytes, "status": item.status,
                "owner": item.owner.full_name if item.owner else None,
                "created_at": item.created_at.isoformat() if item.created_at else None,
            })
    return {"folder_id": str(row.folder_id) if row.folder_id else None, "items": items,
            "can_upload": principal.can(MANAGE) and principal.can("files.manage")}


def ensure_folder(session, contract_id: Any, *, principal) -> dict[str, Any]:
    """The contract's folder, created on first upload under /Contracts."""
    from src.models.content import Folder

    principal.require(MANAGE, "files.manage")
    row = _load(session, contract_id)
    if row.folder_id is None:
        parent = session.scalars(
            select(Folder).where(Folder.path == "/Contracts", Folder.deleted_at.is_(None))
        ).first()
        if parent is None:
            parent = Folder(name="Contracts", path="/Contracts", owner_id=principal.user_id,
                            organization_id=principal.organization_id)
            session.add(parent)
            session.flush()
        path = f"/Contracts/{row.reference}"
        folder = session.scalars(select(Folder).where(Folder.path == path, Folder.deleted_at.is_(None))).first()
        if folder is None:
            folder = Folder(name=row.reference, path=path, parent_id=parent.id, owner_id=principal.user_id,
                            organization_id=principal.organization_id)
            session.add(folder)
            session.flush()
        row.folder_id = folder.id
        session.flush()
    return {"folder_id": str(row.folder_id)}


def _catch_up(session) -> None:
    from src.services.analytics import jobs as analytics_jobs

    analytics_jobs.catch_up(session)
