"""Time spent on work, and the weekly sheet it is approved on.

**One row per stretch of work.** A timer writes `started_at` and, when stopped,
`ended_at` and `minutes`; a manual entry may give either a duration or a start
and an end. `minutes` is always the number that counts, so a report never has
to know which way an entry was made.

**One running timer per person**, enforced by the database: a partial unique
index over the rows that are still running. Two tabs pressing *start* at once
is exactly the race an application-level check loses.

**A week is locked by its sheet.** Once a timesheet is submitted the entries in
it are no longer editable; rejected, they are again. The sheet is the unit a
manager approves, so it is the unit that locks.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, Date, DateTime, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, TimestampMixin, fk, uuid_pk


class TimeEntry(Base, TimestampMixin):
    __tablename__ = "time_entries"
    __table_args__ = (
        Index(
            "uq_time_entries_one_running",
            "user_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL AND source = 'TIMER'"),
        ),
        Index("ix_time_entries_user_date", "user_id", "work_date"),
    )

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = fk("users.id", nullable=False, ondelete="CASCADE")
    #: `task`, `ticket` or `project` — what the time was spent on.
    subject_type: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    subject_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True, index=True)
    subject_label: Mapped[str | None] = mapped_column(String(240))
    #: Denormalised from the subject so the reports by project and customer are
    #: one GROUP BY rather than three joins through two kinds of record.
    project_id: Mapped[UUID | None] = fk("projects.id")
    customer_id: Mapped[UUID | None] = fk("customers.id")
    work_date: Mapped[Any] = mapped_column(Date, nullable=False, index=True)
    started_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    billable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    #: TIMER, MANUAL or GRID (a cell typed into the week grid).
    source: Mapped[str] = mapped_column(String(16), default="MANUAL", nullable=False)

    user = relationship("User", foreign_keys=[user_id], lazy="joined")


class Timesheet(Base, TimestampMixin):
    __tablename__ = "timesheets"
    __table_args__ = (UniqueConstraint("user_id", "week_start", name="uq_timesheets_user_week"),)

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = fk("users.id", nullable=False, ondelete="CASCADE")
    #: The Monday the week starts on.
    week_start: Mapped[Any] = mapped_column(Date, nullable=False, index=True)
    #: DRAFT → SUBMITTED → APPROVED | REJECTED (and back to SUBMITTED).
    status: Mapped[str] = mapped_column(String(16), default="DRAFT", nullable=False, index=True)
    total_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    billable_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    submitted_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    decided_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    decided_by_id: Mapped[UUID | None] = fk("users.id")
    decision_comment: Mapped[str | None] = mapped_column(Text)
    approval_id: Mapped[UUID | None] = fk("approval_requests.id")

    user = relationship("User", foreign_keys=[user_id], lazy="joined")
