"""The AI assistant (§41–46): conversations, their messages, the daily brief,
and one usage ledger every AI call writes to.

The ledger is what rate limiting counts and what the token totals come from —
one row per model call, whichever feature made it, so "how much did the
assistant cost this week" is a single GROUP BY rather than a sum over the
features that happen to remember to record it.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, TimestampMixin, fk, uuid_pk

MODES = ("general", "data")


class AssistantConversation(Base, TimestampMixin):
    """One chat. Private to its owner: nobody else, administrators included,
    reads somebody's conversation through the API."""

    __tablename__ = "assistant_conversations"
    __table_args__ = (Index("ix_assistant_conv_user_recent", "user_id", "last_message_at"),)

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = fk("users.id", nullable=False, ondelete="CASCADE")
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="New conversation")
    #: `general` — a plain assistant; `data` — it may call read-only tools over
    #: the records its owner can see.
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="general")
    last_message_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: What a Data-mode turn may read: `{"records": bool, "collections": [id],
    #: "documents": [id]}` — the records, and/or document collections (§44), or
    #: only some files of them. Absent means records only, as before.
    sources: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    messages = relationship(
        "AssistantMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="AssistantMessage.created_at",
    )


class AssistantMessage(Base, TimestampMixin):
    """One turn. An assistant turn carries what it cost and what it cited."""

    __tablename__ = "assistant_messages"
    __table_args__ = (Index("ix_assistant_msg_conv_time", "conversation_id", "created_at"),)

    id: Mapped[UUID] = uuid_pk()
    conversation_id: Mapped[UUID] = mapped_column(
        ForeignKey("assistant_conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # user | assistant
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="general")
    #: complete | stopped | error
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="complete")
    #: Records the answer used: [{resource_type, id, label, path}].
    citations: Mapped[list[Any] | None] = mapped_column(JSONB)
    #: The tools it called, in order: [{name, arguments, summary}].
    steps: Mapped[list[Any] | None] = mapped_column(JSONB)
    model: Mapped[str | None] = mapped_column(String(80))
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(String(300))

    conversation = relationship("AssistantConversation", back_populates="messages")


class AssistantBrief(Base, TimestampMixin):
    """The daily brief, cached per person per day (§45)."""

    __tablename__ = "assistant_briefs"
    __table_args__ = (UniqueConstraint("user_id", "day", name="uq_assistant_brief_user_day"),)

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = fk("users.id", nullable=False, ondelete="CASCADE")
    day: Mapped[Any] = mapped_column(Date, nullable=False)
    headline: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    #: [{key, title, reason, link, urgency, count}] in the order to deal with them.
    items: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)
    #: ai | fallback — whether a model wrote it or the rules did.
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="fallback")
    model: Mapped[str | None] = mapped_column(String(80))
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    generated_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False)


class AiUsage(Base):
    """One model call, by anybody, for anything. Rate limits count these."""

    __tablename__ = "ai_usage"
    __table_args__ = (Index("ix_ai_usage_user_time", "user_id", "created_at"),)

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE", index=False)
    #: chat | filters | brief | page-help | … (the other AI features add theirs)
    feature: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    model: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ok")
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[Any] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
