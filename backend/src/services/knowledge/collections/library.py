"""Collections: list, read, create, change, remove, and the overview."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import func, literal, or_, select

from src.core import audit, sharing
from src.core.clock import now
from src.core.errors import ValidationError
from src.services.knowledge import ingest as ingest
from src.services.knowledge.collections.access import (
    COLORS,
    KIND,
    MANAGE_PERMISSION,
    MAX_DOCUMENT_BYTES,
    ROOT_FOLDER,
    USE_PERMISSION,
    _collection,
    _counts,
    _owned,
    _serialize_collection,
    _visible,
    visible_ids,
)
from src.services.knowledge.collections.document_store import documents


def listing(session, args: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.knowledge import KnowledgeCollection

    principal.require(USE_PERMISSION)
    statement = select(KnowledgeCollection).where(_visible(principal))
    text = str(args.get("q") or "").strip()
    if text:
        statement = statement.where(or_(
            KnowledgeCollection.name.ilike(f"%{text}%"),
            KnowledgeCollection.description.ilike(f"%{text}%"),
        ))
    scope = str(args.get("scope") or "").strip().lower()
    if scope == "mine":
        statement = statement.where(KnowledgeCollection.owner_id == principal.user_id)
    elif scope == "shared":
        statement = statement.where(KnowledgeCollection.owner_id != principal.user_id)
    rows = session.scalars(
        statement.order_by(func.coalesce(KnowledgeCollection.last_asked_at,
                                         KnowledgeCollection.updated_at).desc())
    ).unique().all()
    counts = _counts(session, [row.id for row in rows])
    return {
        "items": [_serialize_collection(row, principal, counts.get(row.id)) for row in rows],
        "total": len(rows),
        "can_create": principal.can(MANAGE_PERMISSION),
        "supported_extensions": sorted(ingest.SUPPORTED_EXTENSIONS),
        "max_document_bytes": MAX_DOCUMENT_BYTES,
    }


def detail(session, ident: Any, *, principal) -> dict[str, Any]:
    principal.require(USE_PERMISSION)
    row = _collection(session, ident, principal)
    counts = _counts(session, [row.id]).get(row.id)
    return {
        **_serialize_collection(row, principal, counts, sharing.members(session, KIND, row.id)),
        "documents": documents(session, row),
    }


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.knowledge import KnowledgeCollection

    principal.require(USE_PERMISSION, MANAGE_PERMISSION)
    payload = payload if isinstance(payload, dict) else {}
    name = _name(payload.get("name"))
    scope = sharing.scope_of(payload.get("scope"), principal=principal)
    folder = _folder_for(session, name, principal)
    count = session.scalar(select(func.count()).select_from(KnowledgeCollection)) or 0
    row = KnowledgeCollection(
        name=name,
        description=str(payload.get("description") or "").strip()[:2000] or None,
        scope=scope,
        color=_color(payload.get("color"), default=COLORS[count % len(COLORS)]),
        owner_id=principal.user_id,
        organization_id=principal.organization_id,
        folder_id=folder.id,
    )
    session.add(row)
    session.flush()
    if scope == "SHARED":
        sharing.replace_members(session, KIND, row.id, sharing.requested_members(payload),
                                principal=principal, owner_id=row.owner_id)
    audit.record(session, action="CREATE", resource_type="knowledge_collection",
                 resource_id=row.id, resource_label=row.name, principal=principal,
                 after={"name": row.name, "scope": scope}, message=f"created collection {row.name}")
    session.flush()
    return detail(session, row.id, principal=principal)


def update(session, ident: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(USE_PERMISSION, MANAGE_PERMISSION)
    row = _owned(session, ident, principal)
    payload = payload if isinstance(payload, dict) else {}
    before = {"name": row.name, "scope": row.scope, "description": row.description}
    if "name" in payload:
        row.name = _name(payload.get("name"))
    if "description" in payload:
        row.description = str(payload.get("description") or "").strip()[:2000] or None
    if "color" in payload:
        row.color = _color(payload.get("color"), default=row.color or COLORS[0])
    if "scope" in payload:
        row.scope = sharing.scope_of(payload.get("scope"), current=row.scope, principal=principal)
    if "member_ids" in payload:
        sharing.replace_members(session, KIND, row.id, sharing.requested_members(payload),
                                principal=principal, owner_id=row.owner_id)
    session.flush()
    audit.record(session, action="UPDATE", resource_type="knowledge_collection",
                 resource_id=row.id, resource_label=row.name, principal=principal,
                 before=before, after={"name": row.name, "scope": row.scope,
                                       "description": row.description},
                 message=f"updated collection {row.name}", activity=False)
    return detail(session, row.id, principal=principal)


def remove(session, ident: Any, *, principal) -> dict[str, Any]:
    """Soft-delete the collection. Its files stay in the file manager."""
    principal.require(USE_PERMISSION, MANAGE_PERMISSION)
    row = _owned(session, ident, principal)
    row.deleted_at = now()
    session.flush()
    audit.record(session, action="DELETE", resource_type="knowledge_collection",
                 resource_id=row.id, resource_label=row.name, principal=principal,
                 before={"name": row.name}, message=f"removed collection {row.name}")
    return {"id": str(row.id), "deleted": True}


def _name(value: Any) -> str:
    name = str(value or "").strip()
    if not name:
        raise ValidationError("A collection needs a name.", details={"field": "name"})
    if len(name) > 160:
        raise ValidationError("A collection name is at most 160 characters.", details={"field": "name"})
    return name


def _color(value: Any, *, default: str) -> str:
    text = str(value or "").strip()
    return text if re.fullmatch(r"#[0-9A-Fa-f]{6}", text) else default


def _folder_for(session, name: str, principal):
    """`/Knowledge/<name>` in the file manager, made on first use."""
    from src.models.content import Folder

    root = session.scalars(
        select(Folder).where(Folder.path == f"/{ROOT_FOLDER}", Folder.deleted_at.is_(None))
    ).first()
    if root is None:
        root = Folder(name=ROOT_FOLDER, path=f"/{ROOT_FOLDER}", organization_id=principal.organization_id,
                      owner_id=principal.user_id, is_shared=True, color="#7C3AED")
        session.add(root)
        session.flush()
    clean = re.sub(r"[/\\]+", "-", name).strip()[:150] or "Collection"
    path, suffix = f"/{ROOT_FOLDER}/{clean}", 1
    while session.scalar(select(func.count()).select_from(Folder)
                         .where(Folder.path == path, Folder.deleted_at.is_(None))):
        suffix += 1
        path = f"/{ROOT_FOLDER}/{clean} ({suffix})"
    folder = Folder(name=path.rsplit("/", 1)[1], path=path, parent_id=root.id,
                    organization_id=principal.organization_id, owner_id=principal.user_id)
    session.add(folder)
    session.flush()
    return folder


def overview(session, *, principal) -> dict[str, Any]:
    """Headline numbers for the page header."""
    from src.models.knowledge import KnowledgeDocument, KnowledgeQuestion

    principal.require(USE_PERMISSION)
    ids = visible_ids(session, principal)
    counts = _counts(session, ids)
    asked = session.scalar(select(func.count()).select_from(KnowledgeQuestion)
                           .where(KnowledgeQuestion.user_id == principal.user_id)) or 0
    pending = session.scalar(select(func.count()).select_from(KnowledgeDocument).where(
        KnowledgeDocument.collection_id.in_(ids) if ids else literal(False),
        KnowledgeDocument.status.in_(("QUEUED", "PARSING", "CHUNKING", "EMBEDDING")))) or 0
    return {
        "collections": len(ids),
        "documents": sum(c["documents"] for c in counts.values()),
        "pages": sum(c["pages"] for c in counts.values()),
        "passages": sum(c["passages"] for c in counts.values()),
        "pending": pending,
        "questions": asked,
    }
