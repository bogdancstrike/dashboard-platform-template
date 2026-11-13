"""Background jobs, scheduled tasks and import runs."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


class BackgroundJob(Base, TimestampMixin):
    """Job monitoring (§23), and the sink for long exports and imports (§30)."""

    __tablename__ = "background_jobs"

    id: Mapped[UUID] = uuid_pk()
    reference: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(48), default="EXPORT", index=True)
    queue: Mapped[str] = mapped_column(String(48), default="default", index=True)
    status: Mapped[str] = mapped_column(String(24), default="QUEUED", index=True)
    priority: Mapped[str] = mapped_column(String(16), default="NORMAL", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    total_units: Mapped[int] = mapped_column(Integer, default=0)
    processed_units: Mapped[int] = mapped_column(Integer, default=0)
    failed_units: Mapped[int] = mapped_column(Integer, default=0)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    started_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    finished_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, index=True)
    scheduled_for: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    initiated_by_id: Mapped[UUID | None] = fk("users.id")
    initiated_by_label: Mapped[str | None] = mapped_column(String(160))
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    scheduled_task_id: Mapped[UUID | None] = fk("scheduled_tasks.id")
    error_message: Mapped[str | None] = mapped_column(Text)
    #: Job payload and, when finished, the artefact reference a download needs.
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: Inline log lines; the job detail drawer shows them without a join.
    log_lines: Mapped[list[Any] | None] = mapped_column(JSONB)

    initiated_by = relationship("User", foreign_keys=[initiated_by_id], lazy="joined")


class ScheduledTask(Base, TimestampMixin, SoftDeleteMixin):
    """Cron-style recurring work (§11)."""

    __tablename__ = "scheduled_tasks"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    cron: Mapped[str] = mapped_column(String(64), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    job_kind: Mapped[str] = mapped_column(String(48), default="MAINTENANCE", index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    last_run_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    last_status: Mapped[str | None] = mapped_column(String(24), index=True)
    last_duration_ms: Mapped[int | None] = mapped_column(Integer)
    next_run_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    run_count: Mapped[int] = mapped_column(Integer, default=0)
    failure_count: Mapped[int] = mapped_column(Integer, default=0)
    owner_id: Mapped[UUID | None] = fk("users.id")
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class ImportRun(Base, TimestampMixin):
    """One execution of the import wizard (§29), including its row-level
    outcome so the error report stays downloadable afterwards."""

    __tablename__ = "import_runs"

    id: Mapped[UUID] = uuid_pk()
    reference: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    target_entity: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="DRAFT", index=True)
    step: Mapped[str] = mapped_column(String(24), default="UPLOAD")
    delimiter: Mapped[str] = mapped_column(String(4), default=",")
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    valid_rows: Mapped[int] = mapped_column(Integer, default=0)
    invalid_rows: Mapped[int] = mapped_column(Integer, default=0)
    skipped_rows: Mapped[int] = mapped_column(Integer, default=0)
    imported_rows: Mapped[int] = mapped_column(Integer, default=0)
    detected_columns: Mapped[list[Any] | None] = mapped_column(JSONB)
    column_mapping: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: Row payloads held between wizard steps; cleared once executed.
    staged_rows: Mapped[list[Any] | None] = mapped_column(JSONB)
    errors: Mapped[list[Any] | None] = mapped_column(JSONB)
    created_by_id: Mapped[UUID | None] = fk("users.id")
    completed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
