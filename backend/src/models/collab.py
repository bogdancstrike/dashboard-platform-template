"""Collaboration: team chat, read markers, and the wiki (§36, §47–49).

Three ideas hold this module together.

* **A message is a comment.** A channel is one more thing that can be talked
  about, so its messages are rows in `comments` with `resource_type =
  'chat_channel'` — the same mentions, replies, reactions, attachments, edit
  and delete rules a ticket's conversation has. Two message tables would be two
  sets of those rules, and they would drift.
* **"Read up to here" is one row per person per conversation**, for a channel
  and a record's thread alike (`thread_reads`). Unread counts, the "new"
  divider and "seen by" are all questions about that one timestamp.
* **A wiki page is a list of blocks**, the same shape the report builder
  composes, saved whole. Every save writes a revision so history can be read
  and restored; links to records are rows so a record page can ask "which
  pages mention me?" with an index rather than a scan of every page body.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Double, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


class ChatChannel(Base, TimestampMixin):
    """A room people talk in: a named channel, or a direct conversation.

    `direct_key` is the sorted pair of user ids for a DM, unique, so opening a
    conversation with somebody twice finds the first one rather than making a
    second room with the same two people in it.
    """

    __tablename__ = "chat_channels"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    topic: Mapped[str | None] = mapped_column(String(240))
    #: CHANNEL | DIRECT
    kind: Mapped[str] = mapped_column(String(16), default="CHANNEL", nullable=False, index=True)
    #: PUBLIC | PRIVATE. A direct conversation is always PRIVATE.
    visibility: Mapped[str] = mapped_column(String(16), default="PUBLIC", nullable=False, index=True)
    direct_key: Mapped[str | None] = mapped_column(String(80), unique=True)
    created_by_id: Mapped[UUID | None] = fk("users.id")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    last_message_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    archived_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)

    members = relationship("ChatMember", back_populates="channel", lazy="selectin",
                           cascade="all, delete-orphan")


class ChatMember(Base, TimestampMixin):
    """Somebody in a channel. Owners may rename it and manage its members."""

    __tablename__ = "chat_members"
    __table_args__ = (UniqueConstraint("channel_id", "user_id", name="uq_chat_members_channel_user"),)

    id: Mapped[UUID] = uuid_pk()
    channel_id: Mapped[UUID] = fk("chat_channels.id", nullable=False, ondelete="CASCADE")
    user_id: Mapped[UUID] = fk("users.id", nullable=False, ondelete="CASCADE")
    #: OWNER | MEMBER
    role: Mapped[str] = mapped_column(String(16), default="MEMBER", nullable=False)
    muted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    channel = relationship("ChatChannel", back_populates="members")
    user = relationship("User", foreign_keys=[user_id], lazy="joined")


class ThreadRead(Base, TimestampMixin):
    """How far one person has read one conversation — a channel or a record's."""

    __tablename__ = "thread_reads"
    __table_args__ = (
        UniqueConstraint("user_id", "resource_type", "resource_id", name="uq_thread_reads_user_thread"),
    )

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = fk("users.id", nullable=False, ondelete="CASCADE")
    resource_type: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    resource_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    last_read_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False)


class DocSpace(Base, TimestampMixin, SoftDeleteMixin):
    """A top-level shelf of pages: Engineering, Operations, Meetings…"""

    __tablename__ = "doc_spaces"

    id: Mapped[UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String(48), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(400))
    icon: Mapped[str | None] = mapped_column(String(16))
    color: Mapped[str] = mapped_column(String(16), default="#2457D6")
    #: GENERAL | MEETINGS — where "Take notes" files a meeting's page.
    kind: Mapped[str] = mapped_column(String(16), default="GENERAL", nullable=False, index=True)
    position: Mapped[float] = mapped_column(Double, default=0, nullable=False)
    created_by_id: Mapped[UUID | None] = fk("users.id")


class DocPage(Base, TimestampMixin, SoftDeleteMixin):
    """One page of the wiki, nested under a parent within its space.

    `blocks` is the whole body, saved together. `plain_text` is derived from it
    on every save so search is a single indexed column rather than a walk
    through JSON. `position` is sparse and fractional among siblings, so a drag
    writes one row.
    """

    __tablename__ = "doc_pages"

    id: Mapped[UUID] = uuid_pk()
    space_id: Mapped[UUID] = fk("doc_spaces.id", nullable=False, ondelete="CASCADE")
    parent_id: Mapped[UUID | None] = fk("doc_pages.id", ondelete="CASCADE")
    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    icon: Mapped[str | None] = mapped_column(String(16))
    position: Mapped[float] = mapped_column(Double, default=0, nullable=False, index=True)
    blocks: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)
    plain_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    template: Mapped[str | None] = mapped_column(String(32))
    #: Meeting notes: the calendar event they were taken in.
    event_id: Mapped[UUID | None] = fk("calendar_events.id")
    created_by_id: Mapped[UUID | None] = fk("users.id")
    updated_by_id: Mapped[UUID | None] = fk("users.id")

    created_by = relationship("User", foreign_keys=[created_by_id], lazy="joined")
    updated_by = relationship("User", foreign_keys=[updated_by_id], lazy="joined")


class DocRevision(Base):
    """A page as it stood after one save — what history lists and restores."""

    __tablename__ = "doc_revisions"
    __table_args__ = (UniqueConstraint("page_id", "version", name="uq_doc_revisions_page_version"),)

    id: Mapped[UUID] = uuid_pk()
    page_id: Mapped[UUID] = fk("doc_pages.id", nullable=False, ondelete="CASCADE")
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    blocks: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)
    note: Mapped[str | None] = mapped_column(String(200))
    author_id: Mapped[UUID | None] = fk("users.id")
    created_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

    author = relationship("User", foreign_keys=[author_id], lazy="joined")


class DocLink(Base, TimestampMixin):
    """A page ↔ record link, so the record can show the pages about it.

    `source` says how it came to be: MANUAL from the page's "Link a record",
    MENTION from a record block in the body (kept in step on every save), or
    ACTION from an action item that became a task.
    """

    __tablename__ = "doc_links"
    __table_args__ = (
        UniqueConstraint("page_id", "resource_type", "resource_id", name="uq_doc_links_page_record"),
    )

    id: Mapped[UUID] = uuid_pk()
    page_id: Mapped[UUID] = fk("doc_pages.id", nullable=False, ondelete="CASCADE")
    resource_type: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    resource_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="MANUAL")
    created_by_id: Mapped[UUID | None] = fk("users.id")
