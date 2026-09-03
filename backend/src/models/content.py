"""Documents, mail, comments and tags (§14–§16, §20, §36, §37).

The mailbox is modelled as thread + message rather than a flat list, because
threading is the one thing that makes an inbox screen non-trivial and it is
exactly the part a template is worth having.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, MetadataMixin, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


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


class EmailThread(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "email_threads"

    id: Mapped[UUID] = uuid_pk()
    subject: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    folder: Mapped[str] = mapped_column(String(24), default="INBOX", index=True)
    owner_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    message_count: Mapped[int] = mapped_column(Integer, default=1)
    unread_count: Mapped[int] = mapped_column(Integer, default=0, index=True)
    has_attachments: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_starred: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_important: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    labels: Mapped[list[str] | None] = mapped_column(ARRAY(String(48)))
    last_message_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    #: Denormalised so an inbox list renders without joining messages.
    participants: Mapped[list[Any] | None] = mapped_column(JSONB)
    snippet: Mapped[str | None] = mapped_column(String(400))

    messages = relationship(
        "EmailMessage", back_populates="thread", cascade="all, delete-orphan",
        order_by="EmailMessage.sent_at",
    )
    owner = relationship("User", foreign_keys=[owner_id])


class EmailMessage(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "email_messages"

    id: Mapped[UUID] = uuid_pk()
    thread_id: Mapped[UUID | None] = fk("email_threads.id", ondelete="CASCADE")
    message_ref: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    subject: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    from_name: Mapped[str] = mapped_column(String(160), index=True)
    from_email: Mapped[str] = mapped_column(String(255), index=True)
    to_recipients: Mapped[list[Any] | None] = mapped_column(JSONB)
    cc_recipients: Mapped[list[Any] | None] = mapped_column(JSONB)
    bcc_recipients: Mapped[list[Any] | None] = mapped_column(JSONB)
    body_html: Mapped[str | None] = mapped_column(Text)
    body_text: Mapped[str | None] = mapped_column(Text)
    preview: Mapped[str | None] = mapped_column(String(400))
    folder: Mapped[str] = mapped_column(String(24), default="INBOX", index=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_starred: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_draft: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    priority: Mapped[str] = mapped_column(String(16), default="NORMAL", index=True)
    labels: Mapped[list[str] | None] = mapped_column(ARRAY(String(48)))
    sender_id: Mapped[UUID | None] = fk("users.id")
    owner_id: Mapped[UUID | None] = fk("users.id")
    sent_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    scheduled_for: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    read_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    attachment_count: Mapped[int] = mapped_column(Integer, default=0)
    in_reply_to: Mapped[UUID | None] = fk("email_messages.id")

    thread = relationship("EmailThread", back_populates="messages")
    attachments = relationship(
        "EmailAttachment", back_populates="message", cascade="all, delete-orphan"
    )


class EmailAttachment(Base, TimestampMixin):
    __tablename__ = "email_attachments"

    id: Mapped[UUID] = uuid_pk()
    message_id: Mapped[UUID | None] = fk("email_messages.id", ondelete="CASCADE")
    file_id: Mapped[UUID | None] = fk("files.id")
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(128))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    inline: Mapped[bool] = mapped_column(Boolean, default=False)

    message = relationship("EmailMessage", back_populates="attachments")


class EmailTemplate(Base, TimestampMixin, SoftDeleteMixin):
    """Admin-managed transactional templates (§11) and composer templates (§16)."""

    __tablename__ = "email_templates"

    id: Mapped[UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(32), default="TRANSACTIONAL", index=True)
    subject: Mapped[str] = mapped_column(String(300), nullable=False)
    body_html: Mapped[str | None] = mapped_column(Text)
    body_text: Mapped[str | None] = mapped_column(Text)
    locale: Mapped[str] = mapped_column(String(12), default="en-US", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    #: Declared placeholders, so the editor can validate before a send fails.
    variables: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    updated_by_id: Mapped[UUID | None] = fk("users.id")
    last_sent_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    send_count: Mapped[int] = mapped_column(Integer, default=0)


class Comment(Base, TimestampMixin, SoftDeleteMixin):
    """Polymorphic comments (§36). `resource_type` + `resource_id` rather than
    a column per entity: the alternative is a schema change every time a new
    screen wants comments, which is precisely what a template must avoid."""

    __tablename__ = "comments"

    id: Mapped[UUID] = uuid_pk()
    resource_type: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    resource_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    parent_id: Mapped[UUID | None] = fk("comments.id", ondelete="CASCADE")
    author_id: Mapped[UUID | None] = fk("users.id")
    body: Mapped[str] = mapped_column(Text, nullable=False)
    #: User ids referenced with @ — resolved at write time so a mention list
    #: never has to re-parse the body.
    mentions: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    #: {emoji: [user_id, ...]}
    reactions: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    edited_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)

    author = relationship("User", foreign_keys=[author_id], lazy="joined")
    replies = relationship("Comment", remote_side="Comment.parent_id", viewonly=True)


class Tag(Base, TimestampMixin):
    __tablename__ = "tags"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    color: Mapped[str] = mapped_column(String(16), default="#64748b")
    description: Mapped[str | None] = mapped_column(String(240))
    category: Mapped[str] = mapped_column(String(32), default="GENERAL", index=True)
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    created_by_id: Mapped[UUID | None] = fk("users.id")
    #: Maintained on assign/unassign so the tag manager sorts by popularity
    #: without a count(*) per row.
    usage_count: Mapped[int] = mapped_column(Integer, default=0, index=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)


class TagLink(Base, TimestampMixin):
    """Tag → any entity. Same polymorphic pattern as comments, same reason."""

    __tablename__ = "tag_links"
    __table_args__ = (
        UniqueConstraint("tag_id", "resource_type", "resource_id", name="uq_tag_link"),
    )

    id: Mapped[UUID] = uuid_pk()
    tag_id: Mapped[UUID | None] = fk("tags.id", ondelete="CASCADE")
    resource_type: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    resource_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    assigned_by_id: Mapped[UUID | None] = fk("users.id")

    tag = relationship("Tag", lazy="joined")
