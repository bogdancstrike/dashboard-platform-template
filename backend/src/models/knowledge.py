"""Ask your documents (§44): collections of files, what was read from them, and
the questions asked of them.

* A **collection** is a shared-or-private set of files with one audience — the
  platform's sharing rules (`core/sharing`, PRIVATE / SHARED / PUBLIC), so who
  may ask a collection anything is decided the way it is for a dashboard.
* A **document** is one file of the file manager placed in a collection, with
  where its ingest stands. The bytes stay where the file manager put them.
* A **chunk** is a passage read from a document: its text, the page(s) and the
  boxes on the page it came from, a full-text vector and an embedding.
* A **question** is one turn of the conversation with a collection, with the
  answer and the citations that answer points at.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import (
    DDL, Computed, DateTime, Index, Integer, String, Text, UniqueConstraint, event,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.vector import Vector
from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk

#: Where one document's ingest stands, in the order it moves.
DOCUMENT_STATUSES = ("QUEUED", "PARSING", "EMBEDDING", "READY", "FAILED")


class KnowledgeCollection(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "knowledge_collections"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    #: PRIVATE, SHARED (owner + members in `resource_shares`) or PUBLIC.
    scope: Mapped[str] = mapped_column(String(16), default="PRIVATE", index=True)
    color: Mapped[str | None] = mapped_column(String(16))
    owner_id: Mapped[UUID | None] = fk("users.id")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    #: The file-manager folder its uploads land in, so they are ordinary files.
    folder_id: Mapped[UUID | None] = fk("folders.id")
    last_asked_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")


class KnowledgeDocument(Base, TimestampMixin):
    __tablename__ = "knowledge_documents"
    __table_args__ = (UniqueConstraint("collection_id", "file_id"),)

    id: Mapped[UUID] = uuid_pk()
    collection_id: Mapped[UUID] = fk("knowledge_collections.id", nullable=False, ondelete="CASCADE")
    file_id: Mapped[UUID] = fk("files.id", nullable=False, ondelete="CASCADE")
    status: Mapped[str] = mapped_column(String(16), default="QUEUED", index=True)
    #: `docling`, `text` (read here, no converter needed) or `seed`.
    parser: Mapped[str | None] = mapped_column(String(16))
    error_code: Mapped[str | None] = mapped_column(String(48))
    error_message: Mapped[str | None] = mapped_column(Text)
    pages: Mapped[int | None] = mapped_column(Integer)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    embedded_count: Mapped[int] = mapped_column(Integer, default=0)
    outline: Mapped[list[Any] | None] = mapped_column(JSONB)
    warnings: Mapped[list[Any] | None] = mapped_column(JSONB)
    job_id: Mapped[UUID | None] = fk("background_jobs.id")
    added_by_id: Mapped[UUID | None] = fk("users.id")
    started_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    ingested_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))

    file = relationship("FileObject", lazy="joined")
    collection = relationship("KnowledgeCollection")


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"
    __table_args__ = (
        Index("ix_knowledge_chunks_tsv", "tsv", postgresql_using="gin"),
        Index("ix_knowledge_chunks_document_ordinal", "document_id", "ordinal"),
    )

    id: Mapped[UUID] = uuid_pk()
    document_id: Mapped[UUID] = fk("knowledge_documents.id", nullable=False, ondelete="CASCADE")
    #: Denormalised from the document so a search filters one table.
    collection_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False, index=True)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="text")
    text: Mapped[str] = mapped_column(Text, nullable=False)
    heading_path: Mapped[list[Any] | None] = mapped_column(JSONB)
    page_from: Mapped[int | None] = mapped_column(Integer)
    page_to: Mapped[int | None] = mapped_column(Integer)
    #: Where on the page the passage sits: `[{page, x, y, w, h}]`, 0..1 from
    #: the top-left, so the preview can mark it over any rendering size.
    boxes: Mapped[list[Any] | None] = mapped_column(JSONB)
    embedding: Mapped[list[float] | None] = mapped_column(Vector())
    embedding_dims: Mapped[int | None] = mapped_column(Integer, index=True)
    tsv: Mapped[Any | None] = mapped_column(
        TSVECTOR, Computed("to_tsvector('english'::regconfig, text)", persisted=True)
    )


# `create_all` builds a fresh database from these models (the seed does), and
# the `vector` type has to exist before the table that uses it.
event.listen(
    KnowledgeChunk.__table__, "before_create",
    DDL("CREATE EXTENSION IF NOT EXISTS vector"),
)


class KnowledgeQuestion(Base, TimestampMixin):
    __tablename__ = "knowledge_questions"
    __table_args__ = (Index("ix_knowledge_questions_thread", "thread_id", "created_at"),)

    id: Mapped[UUID] = uuid_pk()
    collection_id: Mapped[UUID] = fk("knowledge_collections.id", nullable=False, ondelete="CASCADE")
    user_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    #: Turns of one conversation share it; a new conversation is a new id.
    thread_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str | None] = mapped_column(Text)
    #: `[{n, document_id, file_id, file_name, page, quote, boxes, score}]`.
    citations: Mapped[list[Any] | None] = mapped_column(JSONB)
    #: ANSWERED, NO_ANSWER (nothing relevant was found) or FAILED.
    status: Mapped[str] = mapped_column(String(16), default="ANSWERED", index=True)
    model: Mapped[str | None] = mapped_column(String(80))
    usage: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
