"""A collection's documents: adding, reprocessing, removing, and reading a passage."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.services.knowledge import ingest as ingest
from src.services.knowledge.collections.access import (
    MANAGE_PERMISSION,
    MAX_ADD,
    MAX_DOCUMENT_BYTES,
    STALL_MINUTES,
    USE_PERMISSION,
    _collection,
    _owned,
)


def _stalled(row) -> bool:
    if row.status not in ("QUEUED", "PARSING", "CHUNKING", "EMBEDDING"):
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
    too_large = [f.name for f in files.values() if (f.size_bytes or 0) > MAX_DOCUMENT_BYTES]
    if too_large:
        raise ValidationError(
            "Those files are larger than the 50 MB a document may be.",
            details={"files": too_large, "maximum": MAX_DOCUMENT_BYTES},
        )
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
    if row.status in ("QUEUED", "PARSING", "CHUNKING", "EMBEDDING") and not _stalled(row):
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
