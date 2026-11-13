"""Limits, who sees a collection, and a collection as the API returns it."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, select

from src.core import sharing
from src.core.clock import iso
from src.core.errors import NotFoundError
from src.core.pagination import parse_uuid

#: The feature name in the shared AI usage ledger.
FEATURE = "documents"


#: Asking needs the AI grant; building collections needs this one as well.
USE_PERMISSION = "ai.use"


MANAGE_PERMISSION = "knowledge.manage"


#: The polymorphic key collections are shared under in `resource_shares`.
KIND = "knowledge_collection"


#: The file-manager folder every collection's own folder sits in.
ROOT_FOLDER = "Knowledge"


#: Passages the model is given to answer from.
SOURCES = 8


#: Candidates each retriever contributes before fusion.
CANDIDATES = 24


#: Reciprocal-rank-fusion constant (the usual 60).
RRF_K = 60


#: Turns of the same conversation the model sees, for follow-ups.
HISTORY_TURNS = 3


#: The longest question accepted.
MAX_QUESTION = 2000


#: Documents one request may add.
MAX_ADD = 50


#: The largest file the converter reads (its own limit is 50 MB).
MAX_DOCUMENT_BYTES = 50 * 1024 * 1024


#: A document QUEUED or PARSING for longer than this is stalled, not busy.
STALL_MINUTES = 15


COLORS = ("#2457D6", "#0E9F6E", "#C2410C", "#7C3AED", "#DB2777", "#0891B2", "#CA8A04")


def _visible(principal):
    from src.models.knowledge import KnowledgeCollection

    return and_(
        KnowledgeCollection.deleted_at.is_(None),
        sharing.visibility(KnowledgeCollection, KIND, principal),
    )


def visible_ids(session, principal) -> list[UUID]:
    from src.models.knowledge import KnowledgeCollection

    return list(session.scalars(select(KnowledgeCollection.id).where(_visible(principal))).all())


def _collection(session, ident: Any, principal):
    from src.models.knowledge import KnowledgeCollection

    identifier = parse_uuid(ident, field="collection_id")
    row = session.scalars(
        select(KnowledgeCollection).where(KnowledgeCollection.id == identifier, _visible(principal))
    ).first()
    if row is None:
        # The same answer for "does not exist" and "not yours to see": telling
        # the two apart would tell somebody a private collection is there.
        raise NotFoundError("That collection does not exist.", details={"id": str(identifier)})
    return row


def _owned(session, ident: Any, principal):
    row = _collection(session, ident, principal)
    sharing.require_owner(row, principal, kind="collection")
    return row


def _counts(session, ids: list[UUID]) -> dict[UUID, dict[str, Any]]:
    from src.models.knowledge import KnowledgeDocument

    if not ids:
        return {}
    rows = session.execute(
        select(
            KnowledgeDocument.collection_id,
            KnowledgeDocument.status,
            func.count(),
            func.coalesce(func.sum(KnowledgeDocument.chunk_count), 0),
            func.coalesce(func.sum(KnowledgeDocument.pages), 0),
        )
        .where(KnowledgeDocument.collection_id.in_(ids))
        .group_by(KnowledgeDocument.collection_id, KnowledgeDocument.status)
    ).all()
    out: dict[UUID, dict[str, Any]] = {}
    for collection_id, status, count, chunks, pages in rows:
        entry = out.setdefault(collection_id, {"documents": 0, "ready": 0, "pending": 0,
                                               "failed": 0, "passages": 0, "pages": 0})
        entry["documents"] += count
        entry["passages"] += int(chunks)
        entry["pages"] += int(pages)
        if status == "READY":
            entry["ready"] += count
        elif status == "FAILED":
            entry["failed"] += count
        else:
            entry["pending"] += count
    return out


def _serialize_collection(row, principal, counts: dict[str, Any] | None = None,
                          members: list[dict[str, str]] | None = None) -> dict[str, Any]:
    counts = counts or {"documents": 0, "ready": 0, "pending": 0, "failed": 0, "passages": 0, "pages": 0}
    out = {
        "id": str(row.id),
        "name": row.name,
        "description": row.description or "",
        "scope": row.scope,
        "color": row.color or COLORS[0],
        "owner": {"id": str(row.owner_id) if row.owner_id else None,
                  "name": row.owner.full_name if row.owner else ""},
        "folder_id": str(row.folder_id) if row.folder_id else None,
        "counts": counts,
        "can_edit": row.owner_id == principal.user_id and principal.can(MANAGE_PERMISSION),
        "created_at": iso(row.created_at),
        "updated_at": iso(row.updated_at),
        "last_asked_at": iso(row.last_asked_at),
    }
    if members is not None:
        out["members"] = members
    return out
