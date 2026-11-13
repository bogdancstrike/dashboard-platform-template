"""Folders and stored files."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import (
    Base,
    MetadataMixin,
    SoftDeleteMixin,
    TimestampMixin,
    fk,
    uuid_pk,
)


class Folder(Base, TimestampMixin, SoftDeleteMixin):
    """A node in the file-manager tree (§20). `path` is materialised so a
    breadcrumb costs one row read instead of walking parents one query deep at
    a time."""

    __tablename__ = "folders"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    path: Mapped[str] = mapped_column(String(1000), nullable=False, index=True)
    parent_id: Mapped[UUID | None] = fk("folders.id", ondelete="CASCADE")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    project_id: Mapped[UUID | None] = fk("projects.id")
    owner_id: Mapped[UUID | None] = fk("users.id")
    is_shared: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    color: Mapped[str | None] = mapped_column(String(16))
    file_count: Mapped[int] = mapped_column(Integer, default=0)
    total_size: Mapped[int] = mapped_column(Integer, default=0)

    parent = relationship("Folder", remote_side="Folder.id", backref="children")
    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")


class FileObject(Base, TimestampMixin, SoftDeleteMixin, MetadataMixin):
    """A document or upload. `storage_key` points at the local storage volume;
    swapping in S3/MinIO means changing the service, not this row."""

    __tablename__ = "files"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    extension: Mapped[str | None] = mapped_column(String(16), index=True)
    mime_type: Mapped[str | None] = mapped_column(String(128), index=True)
    kind: Mapped[str] = mapped_column(String(24), default="DOCUMENT", index=True)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, index=True)
    checksum: Mapped[str | None] = mapped_column(String(64), index=True)
    storage_key: Mapped[str | None] = mapped_column(String(500))

    folder_id: Mapped[UUID | None] = fk("folders.id", ondelete="CASCADE")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    project_id: Mapped[UUID | None] = fk("projects.id")
    task_id: Mapped[UUID | None] = fk("tasks.id")
    owner_id: Mapped[UUID | None] = fk("users.id")

    status: Mapped[str] = mapped_column(String(24), default="READY", index=True)
    visibility: Mapped[str] = mapped_column(String(24), default="PRIVATE", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    download_count: Mapped[int] = mapped_column(Integer, default=0)
    last_accessed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    #: Text preview for the split-view pane (§63) without fetching the blob.
    preview_text: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String(48)))

    folder = relationship("Folder", lazy="joined")
    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")
