"""The audit ledger, the activity feed and the system log."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Index, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, TimestampMixin, fk, uuid_pk


class AuditLog(Base, TimestampMixin):
    """Who did what, to which resource, from where, and what changed (§21).

    `actor_label` is denormalised on purpose: an audit row must stay readable
    after the user it refers to is deleted, and the whole point of an audit
    trail is that it survives the thing it describes.
    """

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_resource", "resource_type", "resource_id"),
        Index("ix_audit_actor_time", "actor_id", "occurred_at"),
    )

    id: Mapped[UUID] = uuid_pk()
    occurred_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    resource_id: Mapped[str | None] = mapped_column(String(64), index=True)
    resource_label: Mapped[str | None] = mapped_column(String(255))
    actor_id: Mapped[UUID | None] = fk("users.id")
    actor_label: Mapped[str | None] = mapped_column(String(160), index=True)
    actor_role: Mapped[str | None] = mapped_column(String(48), index=True)
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    result: Mapped[str] = mapped_column(String(16), default="SUCCESS", index=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), index=True)
    user_agent: Mapped[str | None] = mapped_column(String(400))
    correlation_id: Mapped[str | None] = mapped_column(String(64), index=True)
    message: Mapped[str | None] = mapped_column(String(500))
    #: Both sides of the change, plus the computed field list, so the detail
    #: drawer (§21) needs no second query and no diffing in the browser.
    state_before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    state_after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    changed_fields: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    changes: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: Both identities, because "who did this" has two answers when an
    #: administrator is acting as somebody else (§12, §21). `actor_*` is who
    #: the system was treating the request as; these are who was actually at
    #: the keyboard. A boolean alone says an impersonation happened and leaves
    #: the only question anybody asks afterwards unanswered.
    impersonated: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    impersonator_id: Mapped[UUID | None] = fk("users.id")
    impersonator_label: Mapped[str | None] = mapped_column(String(160), index=True)


class ActivityEntry(Base, TimestampMixin):
    """The human-readable feed (§35) — one row per notable thing, scoped so a
    project page can show only its own story."""

    __tablename__ = "activity_entries"
    __table_args__ = (Index("ix_activity_resource", "resource_type", "resource_id"),)

    id: Mapped[UUID] = uuid_pk()
    occurred_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(24), default="RECORD", index=True)
    action: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    actor_id: Mapped[UUID | None] = fk("users.id")
    actor_label: Mapped[str | None] = mapped_column(String(160))
    resource_type: Mapped[str | None] = mapped_column(String(48), index=True)
    resource_id: Mapped[str | None] = mapped_column(String(64), index=True)
    resource_label: Mapped[str | None] = mapped_column(String(255))
    project_id: Mapped[UUID | None] = fk("projects.id")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    summary: Mapped[str | None] = mapped_column(String(500))
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    actor = relationship("User", foreign_keys=[actor_id], lazy="joined")


class SystemLog(Base):
    """Application log lines (§22). No `updated_at`: a log line is never edited,
    and the column would only be a lie taking up space."""

    __tablename__ = "system_logs"
    __table_args__ = (Index("ix_syslog_level_time", "level", "logged_at"),)

    id: Mapped[UUID] = uuid_pk()
    logged_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    level: Mapped[str] = mapped_column(String(12), nullable=False, index=True)
    service: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    logger: Mapped[str | None] = mapped_column(String(120), index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    correlation_id: Mapped[str | None] = mapped_column(String(64), index=True)
    trace_id: Mapped[str | None] = mapped_column(String(64), index=True)
    span_id: Mapped[str | None] = mapped_column(String(32))
    user_id: Mapped[UUID | None] = fk("users.id")
    host: Mapped[str | None] = mapped_column(String(96), index=True)
    environment: Mapped[str] = mapped_column(String(24), default="local", index=True)
    duration_ms: Mapped[float | None] = mapped_column(Numeric(10, 2))
    status_code: Mapped[int | None] = mapped_column(Integer, index=True)
    #: Stack trace / structured context, expanded in the detail pane (§63).
    context: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    stack_trace: Mapped[str | None] = mapped_column(Text)
