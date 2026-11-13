"""Comments, and tags with their links."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


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
    #: Files shared with the message: [{id, name, size_bytes, mime_type}],
    #: copied at write time so a renamed file still reads as what was sent.
    attachments: Mapped[list[Any] | None] = mapped_column(JSONB)
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
