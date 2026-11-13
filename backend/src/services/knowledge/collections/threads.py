"""A collection's question history, forgetting it, and suggested questions."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import iso
from src.core.pagination import parse_uuid
from src.services.knowledge.collections.access import USE_PERMISSION, _collection
from src.services.knowledge.collections.asking import serialize_question


def history(session, ident: Any, args: dict[str, Any], *, principal) -> dict[str, Any]:
    """This person's questions of this collection, newest thread first."""
    from src.models.knowledge import KnowledgeQuestion

    principal.require(USE_PERMISSION)
    collection = _collection(session, ident, principal)
    statement = select(KnowledgeQuestion).where(KnowledgeQuestion.collection_id == collection.id,
                                                KnowledgeQuestion.user_id == principal.user_id)
    rows = session.scalars(statement.order_by(KnowledgeQuestion.created_at.desc()).limit(300)).all()
    thread = args.get("thread_id")
    selected = str(parse_uuid(thread, field="thread_id")) if thread else None
    threads: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = str(row.thread_id)
        entry = threads.setdefault(key, {"thread_id": key, "title": row.question[:120],
                                         "updated_at": iso(row.created_at), "turns": 0})
        entry["turns"] += 1
        entry["title"] = row.question[:120]  # rows are newest first: ends on the first question
    # The list of conversations is always all of them; the turns are the
    # selected conversation's (or every turn, oldest first, when none is).
    turns = [row for row in rows if selected is None or str(row.thread_id) == selected]
    return {
        "items": [serialize_question(row) for row in reversed(turns)],
        "threads": list(threads.values()),
    }


def forget_thread(session, ident: Any, thread_id: Any, *, principal) -> dict[str, Any]:
    from sqlalchemy import delete

    from src.models.knowledge import KnowledgeQuestion

    principal.require(USE_PERMISSION)
    collection = _collection(session, ident, principal)
    identifier = parse_uuid(thread_id, field="thread_id")
    result = session.execute(delete(KnowledgeQuestion).where(
        KnowledgeQuestion.collection_id == collection.id,
        KnowledgeQuestion.user_id == principal.user_id,
        KnowledgeQuestion.thread_id == identifier,
    ))
    return {"thread_id": str(identifier), "removed": result.rowcount or 0}


def suggestions(session, ident: Any, *, principal) -> dict[str, Any]:
    """Questions worth asking, from the collection's own headings."""
    from src.models.knowledge import KnowledgeDocument

    principal.require(USE_PERMISSION)
    collection = _collection(session, ident, principal)
    rows = session.scalars(
        select(KnowledgeDocument).where(KnowledgeDocument.collection_id == collection.id,
                                        KnowledgeDocument.status == "READY")
        .order_by(KnowledgeDocument.created_at)
    ).unique().all()
    # One topic from each document in turn, so a collection of three files
    # does not suggest four questions about the first.
    topics: list[list[str]] = []
    for row in rows:
        titles = [str(entry.get("title") or "").strip() for entry in (row.outline or [])[1:]
                  if isinstance(entry, dict)]
        topics.append([t for t in titles if 3 <= len(t) <= 60 and not t[:1].isdigit()])
    out: list[str] = []
    for depth in range(4):
        for titles in topics:
            if depth < len(titles) and len(out) < 4:
                out.append(f"What do the documents say about {titles[depth].lower()}?")
    if not out:
        out = ["Summarise the main points of these documents.",
               "What deadlines or dates are mentioned?",
               "Who is responsible for what?"]
    return {"items": out[:4]}
