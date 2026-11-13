"""Answering a question from retrieved passages, with citations."""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select

from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.services.ai import usage as ai
from src.services.knowledge.collections.access import (
    FEATURE,
    HISTORY_TURNS,
    MAX_QUESTION,
    USE_PERMISSION,
    _collection,
)
from src.services.knowledge.collections.retrieval import search

SYSTEM_PROMPT = """You answer questions using ONLY the numbered sources provided from the user's documents.
Rules:
- Cite every claim with the source number in square brackets, like [1] or [2][3], right after the claim.
- Use only the sources; never invent facts, numbers, names or dates. If the sources do not contain the answer,
  say plainly that the documents do not say, and do not cite anything.
- Be concise: a short paragraph or a few bullet points. Use Markdown for lists and emphasis only.
- Quote exact figures, deadlines and names as written in the sources."""


def ask(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Answer one question from one collection (or every visible one)."""
    from src.core import llm
    from src.models.knowledge import KnowledgeCollection, KnowledgeQuestion

    principal.require(USE_PERMISSION)
    payload = payload if isinstance(payload, dict) else {}
    question = str(payload.get("question") or "").strip()
    if not question:
        raise ValidationError("Ask a question.", details={"field": "question"})
    if len(question) > MAX_QUESTION:
        raise ValidationError(f"A question is at most {MAX_QUESTION} characters.")
    collection = _collection(session, payload.get("collection_id"), principal)
    thread_id = _thread(payload.get("thread_id"))
    # The shared per-user limit on AI calls, before any work (§41–46).
    ai.guard(session, principal, FEATURE)

    history = session.scalars(
        select(KnowledgeQuestion)
        .where(KnowledgeQuestion.thread_id == thread_id, KnowledgeQuestion.user_id == principal.user_id,
               KnowledgeQuestion.collection_id == collection.id)
        .order_by(KnowledgeQuestion.created_at.desc())
        .limit(HISTORY_TURNS)
    ).all()[::-1]

    # Follow-ups ("and the deadline?") retrieve better with the last question.
    lookup = f"{history[-1].question}\n{question}" if history else question
    sources = search(session, [collection.id], lookup)

    client = llm.get_client()
    status, model, usage = "ANSWERED", getattr(client, "model", ""), None
    if not sources:
        answer, citations, status = (
            "I could not find anything about that in this collection's documents. "
            "Try other words, or add the document that covers it.", [], "NO_ANSWER")
    elif getattr(client, "is_fake", False) and not getattr(client, "script", None):
        answer, citations = _extractive(sources)
    else:
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        for turn in history:
            messages.append({"role": "user", "content": turn.question})
            messages.append({"role": "assistant", "content": _strip_markers(turn.answer or "")})
        messages.append({"role": "user", "content": _prompt(question, sources)})
        try:
            result = client.chat(messages, user=str(principal.user_id), max_tokens=1500)
        except llm.LlmError as exc:
            ai.record_usage(session, principal, FEATURE, status="error")
            session.commit()  # the attempt counts toward the limit even though this request fails
            raise ai.unavailable(exc) from exc
        model, usage = result.model or model, result.usage.to_dict()
        answer, citations = cite(result.text, sources)
        if not citations:
            status = "NO_ANSWER"
        ai.record_usage(session, principal, FEATURE, result.usage, model=model)

    row = KnowledgeQuestion(collection_id=collection.id, user_id=principal.user_id, thread_id=thread_id,
                            question=question, answer=answer, citations=citations, status=status,
                            model=model or None, usage=usage)
    session.add(row)
    session.execute(
        KnowledgeCollection.__table__.update()
        .where(KnowledgeCollection.id == collection.id)
        .values(last_asked_at=now())
    )
    session.flush()
    return serialize_question(row)


def _thread(value: Any) -> UUID:
    if value in (None, ""):
        return uuid4()
    return parse_uuid(value, field="thread_id")


def _prompt(question: str, sources: list[dict[str, Any]]) -> str:
    blocks = []
    for source in sources:
        where = source["file_name"] + (f", page {source['page']}" if source["page"] else "")
        heading = f" — {source['heading']}" if source["heading"] else ""
        blocks.append(f"[{source['n']}] ({where}{heading})\n{source['text']}")
    return "Sources:\n\n" + "\n\n".join(blocks) + f"\n\nQuestion: {question}"


_MARKER = re.compile(r"\[(\d{1,2})\]")


def cite(text: str, sources: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    """Keep the markers that name a real source, renumbered by first appearance."""
    by_n = {source["n"]: source for source in sources}
    order: dict[int, int] = {}
    for match in _MARKER.finditer(text or ""):
        n = int(match.group(1))
        if n in by_n and n not in order:
            order[n] = len(order) + 1

    def renumber(match: re.Match) -> str:
        n = int(match.group(1))
        return f"[{order[n]}]" if n in order else ""

    answer = _MARKER.sub(renumber, text or "").strip()
    citations = []
    for original, new in order.items():
        source = by_n[original]
        citations.append({**_citation(source), "n": new})
    return answer, citations


def _citation(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "n": source["n"],
        "chunk_id": source["chunk_id"],
        "document_id": source["document_id"],
        "file_id": source["file_id"],
        "file_name": source["file_name"],
        "extension": source["extension"],
        "page": source["page"],
        "heading": source["heading"],
        "quote": source["text"][:600],
        "boxes": source["boxes"],
        "score": source["score"],
    }


def _strip_markers(text: str) -> str:
    return _MARKER.sub("", text)


def _extractive(sources: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    """The no-model answer: the best passages' opening sentences, cited.

    What a key-less installation (and the test suite) answers with — honest
    about being extractive, and still exercising citations end to end.
    """
    lines = []
    for source in sources[:2]:
        first = re.split(r"(?<=[.!?])\s+", source["text"].strip())[0][:280]
        lines.append(f"- {first} [{source['n']}]")
    text = "From the documents (extractive answer, no AI model configured):\n\n" + "\n".join(lines)
    return cite(text, sources)


def serialize_question(row) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "collection_id": str(row.collection_id),
        "thread_id": str(row.thread_id),
        "question": row.question,
        "answer": row.answer or "",
        "citations": list(row.citations or []),
        "status": row.status,
        "model": row.model,
        "usage": row.usage,
        "created_at": iso(row.created_at),
    }
