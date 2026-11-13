"""Embedding passages, storing them, and queueing an ingest."""

from __future__ import annotations

from typing import Any

from sqlalchemy import delete

from src.services.knowledge.ingest.chunking import chunk
from src.services.knowledge.ingest.model import (
    EMBED_BATCH,
    EMBED_CHARS,
    MAX_EMBEDDED,
    Parsed,
)


def embed(texts: list[str]) -> tuple[list[list[float]] | None, str | None]:
    """Vectors for the texts, or `(None, reason)` when the model cannot give them."""
    from src.core import llm

    if not texts:
        return [], None
    client = llm.get_client()
    vectors: list[list[float]] = []
    try:
        for start in range(0, len(texts), EMBED_BATCH):
            batch = [t[:EMBED_CHARS] for t in texts[start:start + EMBED_BATCH]]
            vectors.extend(client.embed(batch))
    except llm.LlmError as exc:
        return None, exc.code
    if len(vectors) != len(texts):
        return None, "LLM_BAD_OUTPUT"
    return vectors, None


def embed_query(text: str) -> list[float] | None:
    vectors, _reason = embed([text])
    return vectors[0] if vectors else None


def store(session, document, parsed: Parsed, passages: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Replace a document's passages with these, embedded where possible."""
    from src.models.knowledge import KnowledgeChunk

    passages = chunk(parsed.sections) if passages is None else passages
    vectors, reason = embed([_embedding_text(p) for p in passages[:MAX_EMBEDDED]])
    warnings = list(dict.fromkeys(parsed.warnings))
    if reason:
        warnings.append(f"EMBEDDINGS_UNAVAILABLE:{reason}")
    if len(passages) > MAX_EMBEDDED and vectors:
        warnings.append(f"EMBEDDED_FIRST_{MAX_EMBEDDED}")
    if not passages:
        warnings.append("NO_TEXT_EXTRACTED")

    session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.document_id == document.id))
    for index, passage in enumerate(passages):
        vector = vectors[index] if vectors and index < len(vectors) else None
        session.add(KnowledgeChunk(
            document_id=document.id,
            collection_id=document.collection_id,
            ordinal=passage["ordinal"],
            kind=passage["kind"],
            text=passage["text"],
            heading_path=passage["heading_path"] or None,
            page_from=passage["page_from"],
            page_to=passage["page_to"],
            boxes=passage["boxes"] or None,
            embedding=vector,
            embedding_dims=len(vector) if vector else None,
        ))
    document.pages = parsed.pages
    document.parser = parsed.parser
    document.outline = parsed.outline or None
    document.warnings = warnings or None
    document.chunk_count = len(passages)
    document.embedded_count = len(vectors or [])
    session.flush()
    return {"chunks": len(passages), "embedded": document.embedded_count, "warnings": warnings}


def _embedding_text(passage: dict[str, Any]) -> str:
    """The passage with the headings it sits under, which carry its subject."""
    path = " › ".join(passage.get("heading_path") or [])
    return f"{path}\n{passage['text']}" if path else passage["text"]
