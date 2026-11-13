"""Hybrid retrieval: the passages a question is answered from."""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from sqlalchemy import and_, cast, func, literal, select

from src.core.errors import NotFoundError
from src.core.pagination import parse_uuid
from src.services.knowledge import ingest as ingest
from src.services.knowledge.collections.access import (
    CANDIDATES,
    RRF_K,
    SOURCES,
    USE_PERMISSION,
    _collection,
)


def passage(session, ident: Any, chunk_id: Any, *, principal) -> dict[str, Any]:
    """One passage with what a preview needs to show it in place."""
    from src.models.knowledge import KnowledgeChunk, KnowledgeDocument

    principal.require(USE_PERMISSION)
    collection = _collection(session, ident, principal)
    identifier = parse_uuid(chunk_id, field="chunk_id")
    row = session.execute(
        select(KnowledgeChunk, KnowledgeDocument)
        .join(KnowledgeDocument, KnowledgeDocument.id == KnowledgeChunk.document_id)
        .where(KnowledgeChunk.id == identifier, KnowledgeChunk.collection_id == collection.id)
    ).first()
    if row is None:
        raise NotFoundError("That passage is not in this collection.", details={"id": str(identifier)})
    chunk, document = row
    return _source(chunk, document, 0, 0.0)


def search(session, collection_ids: list[UUID], question: str, *, limit: int = SOURCES) -> list[dict[str, Any]]:
    """The passages that best answer `question`, from these collections only."""
    from src.models.knowledge import KnowledgeChunk, KnowledgeDocument

    if not collection_ids:
        return []
    ready = (
        select(KnowledgeDocument.id)
        .where(KnowledgeDocument.collection_id.in_(collection_ids), KnowledgeDocument.status == "READY")
    )
    scope = and_(KnowledgeChunk.collection_id.in_(collection_ids), KnowledgeChunk.document_id.in_(ready))

    ranked: dict[UUID, float] = {}
    vector = ingest.embed_query(question)
    if vector:
        from src.models.vector import Vector

        distance = KnowledgeChunk.embedding.op("<=>")(cast(literal(vector, type_=Vector()), Vector()))
        hits = session.execute(
            select(KnowledgeChunk.id)
            .where(scope, KnowledgeChunk.embedding_dims == len(vector))
            .order_by(distance)
            .limit(CANDIDATES)
        ).scalars().all()
        for rank, chunk_id in enumerate(hits):
            ranked[chunk_id] = ranked.get(chunk_id, 0.0) + 1.0 / (RRF_K + rank + 1)

    terms = _terms(question)
    if terms:
        query = func.to_tsquery("english", " | ".join(terms))
        hits = session.execute(
            select(KnowledgeChunk.id)
            .where(scope, KnowledgeChunk.tsv.op("@@")(query))
            .order_by(func.ts_rank_cd(KnowledgeChunk.tsv, query).desc())
            .limit(CANDIDATES)
        ).scalars().all()
        for rank, chunk_id in enumerate(hits):
            ranked[chunk_id] = ranked.get(chunk_id, 0.0) + 1.0 / (RRF_K + rank + 1)

    best = sorted(ranked.items(), key=lambda item: item[1], reverse=True)[:limit]
    if not best:
        return []
    rows = {
        chunk.id: (chunk, document)
        for chunk, document in session.execute(
            select(KnowledgeChunk, KnowledgeDocument)
            .join(KnowledgeDocument, KnowledgeDocument.id == KnowledgeChunk.document_id)
            .where(KnowledgeChunk.id.in_([chunk_id for chunk_id, _ in best]))
        ).unique().all()
    }
    return [_source(*rows[chunk_id], index + 1, score)
            for index, (chunk_id, score) in enumerate(best) if chunk_id in rows]


_STOP = frozenset("""a an and are as at be by can could did do does for from had has have how i if in
into is it its me my of on or our should so than that the their them then there these they this to
was we were what when where which who why will with would you your about tell please""".split())


def _terms(question: str) -> list[str]:
    words = re.findall(r"[A-Za-z0-9]{2,}", question.lower())
    return list(dict.fromkeys(w for w in words if w not in _STOP))[:16]


def _source(chunk, document, n: int, score: float) -> dict[str, Any]:
    file = document.file
    return {
        "n": n,
        "chunk_id": str(chunk.id),
        "document_id": str(document.id),
        "collection_id": str(document.collection_id),
        "file_id": str(file.id) if file else None,
        "file_name": file.name if file else "",
        "extension": file.extension if file else None,
        "page": chunk.page_from,
        "page_to": chunk.page_to,
        "heading": " › ".join(chunk.heading_path or []),
        "text": chunk.text,
        "boxes": list(chunk.boxes or []),
        "score": round(float(score), 5),
    }
