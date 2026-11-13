"""Projects, tasks and calendar events."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Double, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import (
    Base,
    MetadataMixin,
    SoftDeleteMixin,
    TimestampMixin,
    fk,
    uuid_pk,
)


class Project(Base, TimestampMixin, SoftDeleteMixin, MetadataMixin):
    __tablename__ = "projects"

    id: Mapped[UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(24), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="ACTIVE", index=True)
    phase: Mapped[str] = mapped_column(String(24), default="EXECUTION", index=True)
    priority: Mapped[str] = mapped_column(String(16), default="NORMAL", index=True)
    health: Mapped[str] = mapped_column(String(16), default="ON_TRACK", index=True)

    organization_id: Mapped[UUID | None] = fk("organizations.id")
    department_id: Mapped[UUID | None] = fk("departments.id")
    owner_id: Mapped[UUID | None] = fk("users.id")
    customer_id: Mapped[UUID | None] = fk("customers.id")
    region_id: Mapped[UUID | None] = fk("regions.id")

    start_date: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    due_date: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    completed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    budget: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    spent: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    currency: Mapped[str] = mapped_column(String(8), default="EUR")
    progress: Mapped[int] = mapped_column(Integer, default=0, index=True)
    task_count: Mapped[int] = mapped_column(Integer, default=0)
    open_task_count: Mapped[int] = mapped_column(Integer, default=0)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String(48)))
    color: Mapped[str] = mapped_column(String(16), default="#5b5bd6")

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")
    organization = relationship("Organization", lazy="joined")
    customer = relationship("Customer", lazy="joined")
    tasks = relationship("Task", back_populates="project", cascade="all, delete-orphan")


class Task(Base, TimestampMixin, SoftDeleteMixin, MetadataMixin):
    """The work queue of §18 — table, list and kanban all read this one table.

    `board_position` exists so drag-and-drop reordering survives a reload; a
    kanban that forgets where you put a card is not a kanban.
    """

    __tablename__ = "tasks"

    id: Mapped[UUID] = uuid_pk()
    reference: Mapped[str] = mapped_column(String(24), nullable=False, unique=True, index=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="NEW", index=True)
    priority: Mapped[str] = mapped_column(String(16), default="NORMAL", index=True)
    kind: Mapped[str] = mapped_column(String(24), default="TASK", index=True)

    project_id: Mapped[UUID | None] = fk("projects.id", ondelete="CASCADE")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    assignee_id: Mapped[UUID | None] = fk("users.id")
    requester_id: Mapped[UUID | None] = fk("users.id")
    parent_id: Mapped[UUID | None] = fk("tasks.id")

    due_date: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    started_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    estimate_hours: Mapped[float | None] = mapped_column(Numeric(8, 2))
    logged_hours: Mapped[float] = mapped_column(Numeric(8, 2), default=0)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    #: A sparse, fractional rank within the task's lane (its status): a drop
    #: takes the midpoint of its neighbours, so a move writes one row. See
    #: `services/task_board.py`.
    board_position: Mapped[float] = mapped_column(Double, default=0, index=True)
    blocked_reason: Mapped[str | None] = mapped_column(String(240))
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String(48)))
    checklist: Mapped[list[Any] | None] = mapped_column(JSONB)

    # ── Work planning (`models/planning.py`) ─────────────────────────────
    #: When the work is planned to begin; the timeline's bar runs from here to
    #: `due_date`.
    start_date: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    story_points: Mapped[float | None] = mapped_column(Numeric(5, 1))
    sprint_id: Mapped[UUID | None] = fk("sprints.id")
    #: When it joined its sprint, so a sprint report can tell committed work
    #: from work added after the start.
    sprint_added_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    #: The epic (a task of kind EPIC) this work belongs to.
    epic_id: Mapped[UUID | None] = fk("tasks.id")
    #: The backlog's hand-made order — sparse and fractional, like
    #: `board_position`, so a drop writes one row.
    backlog_rank: Mapped[float] = mapped_column(Double, default=0, server_default="0", nullable=False, index=True)
    is_milestone: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    cover_color: Mapped[str | None] = mapped_column(String(16))
    #: When the status last changed — the card's age in its lane.
    status_changed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    #: The recurrence that made this task, when one did. A plain reference,
    #: not a foreign key: `task_recurrences.task_id` already points back here,
    #: and two foreign keys between the same tables are a cycle no delete
    #: order satisfies.
    recurrence_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True), index=True)

    project = relationship("Project", back_populates="tasks")
    assignee = relationship("User", foreign_keys=[assignee_id], lazy="joined")
    requester = relationship("User", foreign_keys=[requester_id])
    parent = relationship("Task", remote_side="Task.id", backref="subtasks", foreign_keys=[parent_id])


class CalendarEvent(Base, TimestampMixin, SoftDeleteMixin, MetadataMixin):
    """Calendar module (§19). Recurrence is stored as an RRULE-shaped document
    plus a materialised `recurrence_until`, so a month view can range-scan
    without expanding every series."""

    __tablename__ = "calendar_events"

    id: Mapped[UUID] = uuid_pk()
    title: Mapped[str] = mapped_column(String(240), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(32), default="MEETING", index=True)
    status: Mapped[str] = mapped_column(String(24), default="CONFIRMED", index=True)
    location: Mapped[str | None] = mapped_column(String(200))
    starts_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ends_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    organizer_id: Mapped[UUID | None] = fk("users.id")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    project_id: Mapped[UUID | None] = fk("projects.id")
    task_id: Mapped[UUID | None] = fk("tasks.id")
    #: [{user_id, name, response}] — inline because an attendee list is only
    #: ever read with its event.
    participants: Mapped[list[Any] | None] = mapped_column(JSONB)
    recurrence: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    recurrence_until: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    reminder_minutes: Mapped[int | None] = mapped_column(Integer)
    color: Mapped[str] = mapped_column(String(16), default="#5b5bd6")

    organizer = relationship("User", foreign_keys=[organizer_id], lazy="joined")
