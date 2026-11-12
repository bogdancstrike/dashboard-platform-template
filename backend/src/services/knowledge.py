"""Ask your documents (§44): collections, their files, and questions with citations.

**Who sees what.** A collection has the platform's one sharing model
(`core/sharing`): private to its owner, shared with named people, or public.
Every read below starts from that predicate, so a question can only ever be
answered from passages of collections its asker may see — retrieval filters on
the visible collection ids in SQL, not on the result afterwards.

**Where the files live.** A collection's uploads are ordinary files of the
file manager, in a folder of their own under `/Knowledge`, so they can be
previewed, downloaded and moved like any other. A collection can also take a
file that is already there. What the collection adds is the reading:
`services/knowledge_ingest` turns each file into passages with their page and
position, and this module asks questions of them.

**How an answer is made.** Retrieval is hybrid: the question's embedding
against the passages' (cosine, exact) and PostgreSQL full-text search, fused
by reciprocal rank — so a passage that uses the question's words is found
even where embeddings are unavailable, and one that answers it in other words
is found by meaning. The model sees numbered sources and must cite them as
`[n]`; the answer's citations are exactly the sources it cited, renumbered in
the order they first appear, each with the file, the page and the boxes to
mark. An answer that cites nothing it was given says so rather than pretend.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import and_, cast, func, literal, or_, select

from src.core import audit, sharing
from src.core.clock import iso, now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.services import ai
from src.services import knowledge_ingest as ingest

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
#: A document QUEUED or PARSING for longer than this is stalled, not busy.
STALL_MINUTES = 15
COLORS = ("#2457D6", "#0E9F6E", "#C2410C", "#7C3AED", "#DB2777", "#0891B2", "#CA8A04")


# ── reading collections ──────────────────────────────────────────────────


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
    }


def detail(session, ident: Any, *, principal) -> dict[str, Any]:
    principal.require(USE_PERMISSION)
    row = _collection(session, ident, principal)
    counts = _counts(session, [row.id]).get(row.id)
    return {
        **_serialize_collection(row, principal, counts, sharing.members(session, KIND, row.id)),
        "documents": documents(session, row),
    }


# ── writing collections ──────────────────────────────────────────────────


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


# ── documents ────────────────────────────────────────────────────────────


def _stalled(row) -> bool:
    if row.status not in ("QUEUED", "PARSING", "EMBEDDING"):
        return False
    since = row.started_at or row.created_at
    return since is not None and (now() - since).total_seconds() > STALL_MINUTES * 60


def serialize_document(row) -> dict[str, Any]:
    file = row.file
    return {
        "id": str(row.id),
        "collection_id": str(row.collection_id),
        "file": {
            "id": str(file.id) if file else None,
            "name": file.name if file else "(missing file)",
            "extension": file.extension if file else None,
            "kind": file.kind if file else None,
            "size_bytes": int(file.size_bytes or 0) if file else 0,
            "mime_type": file.mime_type if file else None,
        },
        "status": row.status,
        "stalled": _stalled(row),
        "parser": row.parser,
        "error_code": row.error_code,
        "error_message": row.error_message,
        "pages": row.pages,
        "chunk_count": int(row.chunk_count or 0),
        "embedded_count": int(row.embedded_count or 0),
        "warnings": list(row.warnings or []),
        "outline": list(row.outline or [])[:50],
        "job_id": str(row.job_id) if row.job_id else None,
        "added_at": iso(row.created_at),
        "ingested_at": iso(row.ingested_at),
    }


def documents(session, collection) -> list[dict[str, Any]]:
    from src.models.knowledge import KnowledgeDocument

    rows = session.scalars(
        select(KnowledgeDocument)
        .where(KnowledgeDocument.collection_id == collection.id)
        .order_by(KnowledgeDocument.created_at.desc())
    ).unique().all()
    return [serialize_document(row) for row in rows]


def add_documents(session, ident: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Put files of the file manager in the collection and start reading them.

    The caller commits; `start_pending` then spawns the work, so a job never
    looks for a row still inside this transaction.
    """
    from src.models.content import FileObject
    from src.models.knowledge import KnowledgeDocument

    principal.require(USE_PERMISSION, MANAGE_PERMISSION)
    row = _owned(session, ident, principal)
    raw = (payload or {}).get("file_ids") if isinstance(payload, dict) else None
    if not isinstance(raw, (list, tuple)) or not raw:
        raise ValidationError("Name the files to add.", details={"field": "file_ids"})
    if len(raw) > MAX_ADD:
        raise ValidationError(f"At most {MAX_ADD} files at once.", details={"count": len(raw)})
    ids = list(dict.fromkeys(parse_uuid(value, field="file_id") for value in raw))
    files = {
        f.id: f for f in session.scalars(
            select(FileObject).where(FileObject.id.in_(ids), FileObject.deleted_at.is_(None))
        ).unique().all()
    }
    missing = [str(i) for i in ids if i not in files]
    if missing:
        raise NotFoundError("One or more files do not exist.", details={"file_ids": missing})
    unready = [f.name for f in files.values() if f.status != "READY"]
    if unready:
        raise ConflictError("Those files are still uploading.", details={"files": unready})
    unsupported = [f.name for f in files.values()
                   if storage_extension(f.name) not in ingest.SUPPORTED_EXTENSIONS]
    if unsupported:
        raise ValidationError(
            "Those files cannot be read for questions.",
            details={"files": unsupported, "supported": sorted(ingest.SUPPORTED_EXTENSIONS)},
        )

    existing = {
        d.file_id: d for d in session.scalars(
            select(KnowledgeDocument).where(KnowledgeDocument.collection_id == row.id,
                                            KnowledgeDocument.file_id.in_(ids))
        ).unique().all()
    }
    added: list[Any] = []
    for file_id in ids:
        if file_id in existing:
            continue
        document = KnowledgeDocument(collection_id=row.id, file_id=file_id,
                                     added_by_id=principal.user_id, status="QUEUED")
        session.add(document)
        session.flush()
        session.refresh(document)
        ingest.queue(session, document, principal=principal)
        added.append(document)
    row.updated_at = now()
    session.flush()
    if added:
        audit.record(session, action="UPDATE", resource_type="knowledge_collection",
                     resource_id=row.id, resource_label=row.name, principal=principal,
                     after={"added": [files[d.file_id].name for d in added]},
                     message=f"added {len(added)} file(s) to {row.name}")
    return {
        "added": [serialize_document(d) for d in added],
        "skipped": [str(i) for i in ids if i in existing],
        "pending": [str(d.id) for d in added],
    }


def storage_extension(name: str) -> str:
    from src.core import storage

    return storage.extension_of(name)


def start_pending(document_ids: list[str]) -> list[str]:
    """Spawn the reading of documents queued by a committed request."""
    return [ingest.start(UUID(str(i))) for i in document_ids]


def _document(session, collection, document_id: Any):
    from src.models.knowledge import KnowledgeDocument

    identifier = parse_uuid(document_id, field="document_id")
    row = session.scalars(
        select(KnowledgeDocument).where(KnowledgeDocument.id == identifier,
                                        KnowledgeDocument.collection_id == collection.id)
    ).first()
    if row is None:
        raise NotFoundError("That document is not in this collection.", details={"id": str(identifier)})
    return row


def document_detail(session, ident: Any, document_id: Any, *, principal) -> dict[str, Any]:
    principal.require(USE_PERMISSION)
    collection = _collection(session, ident, principal)
    return serialize_document(_document(session, collection, document_id))


def reprocess(session, ident: Any, document_id: Any, *, principal) -> dict[str, Any]:
    principal.require(USE_PERMISSION, MANAGE_PERMISSION)
    collection = _owned(session, ident, principal)
    row = _document(session, collection, document_id)
    if row.status in ("QUEUED", "PARSING", "EMBEDDING") and not _stalled(row):
        raise ConflictError("That document is being read right now.", details={"status": row.status})
    ingest.queue(session, row, principal=principal)
    session.flush()
    return {**serialize_document(row), "pending": [str(row.id)]}


def remove_document(session, ident: Any, document_id: Any, *, principal) -> dict[str, Any]:
    """Take a file out of the collection. The file itself stays where it is."""
    principal.require(USE_PERMISSION, MANAGE_PERMISSION)
    collection = _owned(session, ident, principal)
    row = _document(session, collection, document_id)
    name = row.file.name if row.file else ""
    session.delete(row)
    session.flush()
    audit.record(session, action="UPDATE", resource_type="knowledge_collection",
                 resource_id=collection.id, resource_label=collection.name, principal=principal,
                 before={"removed": name}, message=f"removed {name} from {collection.name}",
                 activity=False)
    return {"id": str(document_id), "removed": True}


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


# ── retrieval ────────────────────────────────────────────────────────────


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


# ── asking ───────────────────────────────────────────────────────────────

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
        KnowledgeDocument.status.in_(("QUEUED", "PARSING", "EMBEDDING")))) or 0
    return {
        "collections": len(ids),
        "documents": sum(c["documents"] for c in counts.values()),
        "pages": sum(c["pages"] for c in counts.values()),
        "passages": sum(c["passages"] for c in counts.values()),
        "pending": pending,
        "questions": asked,
    }

