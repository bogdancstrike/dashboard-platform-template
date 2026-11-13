"""Mail threads, messages, attachments and templates."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


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
