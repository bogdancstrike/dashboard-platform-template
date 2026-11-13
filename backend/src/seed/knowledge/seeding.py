"""Seed data for knowledge: seed, seed_safely."""

from __future__ import annotations

from datetime import timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import select

from src.core.clock import now
from src.seed.knowledge.doc import Doc
from src.seed.knowledge.rendering import COLLECTIONS, _questions, render


def seed(session, *, store=None) -> dict[str, int]:
    """Create the seeded collections that are missing. Idempotent."""
    from src.core import storage
    from src.models.content import FileObject, Folder
    from src.models.identity import User
    from src.models.knowledge import KnowledgeCollection, KnowledgeDocument
    from src.models.personal import ResourceShare
    from src.services.knowledge import ingest as ingest

    users = {u.username: u for u in session.scalars(
        select(User).where(User.username.in_(("admin", "manager", "operator", "analyst", "user"))))}
    if "admin" not in users:
        return {"collections": 0, "documents": 0, "skipped": "no personas"}
    store = store or storage.for_config()
    anchor = now()
    made = documents = 0

    root = session.scalars(select(Folder).where(Folder.path == "/Knowledge", Folder.deleted_at.is_(None))).first()
    if root is None:
        root = Folder(name="Knowledge", path="/Knowledge", owner_id=users["admin"].id,
                      organization_id=users["admin"].organization_id, is_shared=True, color="#7C3AED")
        session.add(root)
        session.flush()

    for offset, (name, description, scope, owner_name, members, color, docs) in enumerate(COLLECTIONS):
        owner = users.get(owner_name) or users["admin"]
        exists = session.scalars(select(KnowledgeCollection).where(
            KnowledgeCollection.name == name, KnowledgeCollection.owner_id == owner.id,
            KnowledgeCollection.deleted_at.is_(None))).first()
        if exists is not None:
            continue
        created = anchor - timedelta(days=24 - offset * 5)
        folder = session.scalars(select(Folder).where(Folder.path == f"/Knowledge/{name}",
                                                      Folder.deleted_at.is_(None))).first()
        if folder is None:
            folder = Folder(name=name, path=f"/Knowledge/{name}", parent_id=root.id, owner_id=owner.id,
                            organization_id=owner.organization_id)
            session.add(folder)
            session.flush()
        collection = KnowledgeCollection(name=name, description=description, scope=scope, color=color,
                                         owner_id=owner.id, organization_id=owner.organization_id,
                                         folder_id=folder.id, created_at=created, updated_at=created)
        session.add(collection)
        session.flush()
        for member in members:
            if member in users and users[member].id != owner.id:
                session.add(ResourceShare(resource_type="knowledge_collection", resource_id=str(collection.id),
                                          user_id=users[member].id, shared_by_id=owner.id, permission="VIEW"))
        made += 1

        for position, doc in enumerate(docs):
            if isinstance(doc, Doc):
                filename, (body, sections, pages) = doc.name, render(doc)
                parsed = ingest.Parsed(
                    sections=[ingest.Section(**s) for s in sections], pages=pages,
                    outline=[{"title": s["text"], "page": s["page_from"]} for s in sections
                             if len(s["heading_path"]) and s["text"] == s["heading_path"][-1]],
                    warnings=[], parser="seed")
                content_type = "application/pdf"
            else:
                filename, text = doc
                body = text.encode()
                parsed = ingest.parse_text(body, "md")
                content_type = "text/markdown"
            key = storage.key_for("files", "knowledge", f"{uuid4().hex}.{storage.extension_of(filename)}")
            stored = store.put(key, body, content_type=content_type)
            when = created + timedelta(hours=2 + position)
            file = FileObject(name=filename, extension=storage.extension_of(filename), mime_type=content_type,
                              kind="DOCUMENT", size_bytes=stored.size_bytes, checksum=stored.checksum,
                              storage_key=key, folder_id=folder.id, owner_id=owner.id,
                              organization_id=owner.organization_id, status="READY", visibility="PRIVATE",
                              created_at=when, updated_at=when)
            session.add(file)
            session.flush()
            document = KnowledgeDocument(collection_id=collection.id, file_id=file.id, status="READY",
                                         added_by_id=owner.id, started_at=when, ingested_at=when,
                                         created_at=when, updated_at=when)
            session.add(document)
            session.flush()
            ingest.store(session, document, parsed)
            documents += 1

    session.flush()
    _questions(session, users)
    return {"collections": made, "documents": documents}


def seed_safely(session) -> dict[str, Any]:
    """`seed`, inside a savepoint: no object storage means no collections, not no seed."""
    from framework.commons.logger import logger as log

    try:
        with session.begin_nested():
            return seed(session)
    except Exception as exc:  # noqa: BLE001 - the rest of the dataset must still land
        log.warning(f"seed[knowledge] skipped: {type(exc).__name__}: {exc} — "
                    "run 'python -m src.seed --sync-knowledge' once storage is up", "yellow")
        return {"collections": 0, "documents": 0, "skipped": type(exc).__name__}
