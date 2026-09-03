"""The business entities the list/detail patterns are demonstrated on (§7).

Deliberately several *different shapes* rather than seven copies of one:
projects carry budgets and dates, tickets carry SLA clocks, orders carry money
and line items, tasks carry a kanban lifecycle, devices carry telemetry. A
template whose entities are all the same teaches nothing about the cases the
first real project will hit.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, MetadataMixin, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


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


class Customer(Base, TimestampMixin, SoftDeleteMixin, MetadataMixin):
    __tablename__ = "customers"

    id: Mapped[UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(24), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    legal_name: Mapped[str | None] = mapped_column(String(220))
    email: Mapped[str | None] = mapped_column(String(255), index=True)
    phone: Mapped[str | None] = mapped_column(String(48))
    website: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(24), default="ACTIVE", index=True)
    segment: Mapped[str] = mapped_column(String(24), default="SMB", index=True)
    industry: Mapped[str | None] = mapped_column(String(80), index=True)
    lifecycle_stage: Mapped[str] = mapped_column(String(24), default="CUSTOMER", index=True)
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    account_manager_id: Mapped[UUID | None] = fk("users.id")
    region_id: Mapped[UUID | None] = fk("regions.id")
    country: Mapped[str | None] = mapped_column(String(96), index=True)
    city: Mapped[str | None] = mapped_column(String(96))
    lifetime_value: Mapped[float] = mapped_column(Numeric(14, 2), default=0, index=True)
    open_orders: Mapped[int] = mapped_column(Integer, default=0)
    #: Net promoter style score, so the comparison page (§47) has a metric that
    #: is meaningfully missing on some rows.
    satisfaction: Mapped[int | None] = mapped_column(Integer, index=True)
    last_contact_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String(48)))

    account_manager = relationship("User", foreign_keys=[account_manager_id], lazy="joined")
    organization = relationship("Organization", lazy="joined")


class Ticket(Base, TimestampMixin, SoftDeleteMixin, MetadataMixin):
    __tablename__ = "tickets"

    id: Mapped[UUID] = uuid_pk()
    reference: Mapped[str] = mapped_column(String(24), nullable=False, unique=True, index=True)
    subject: Mapped[str] = mapped_column(String(240), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="OPEN", index=True)
    priority: Mapped[str] = mapped_column(String(16), default="NORMAL", index=True)
    severity: Mapped[str] = mapped_column(String(16), default="MINOR", index=True)
    category: Mapped[str] = mapped_column(String(48), default="SUPPORT", index=True)
    channel: Mapped[str] = mapped_column(String(24), default="EMAIL", index=True)

    organization_id: Mapped[UUID | None] = fk("organizations.id")
    customer_id: Mapped[UUID | None] = fk("customers.id")
    project_id: Mapped[UUID | None] = fk("projects.id")
    assignee_id: Mapped[UUID | None] = fk("users.id")
    reporter_id: Mapped[UUID | None] = fk("users.id")

    due_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    first_response_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    #: Minutes. Precomputed so a table can sort by it without a window function.
    resolution_minutes: Mapped[int | None] = mapped_column(Integer, index=True)
    sla_breached: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    reopen_count: Mapped[int] = mapped_column(Integer, default=0)
    satisfaction: Mapped[int | None] = mapped_column(Integer)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String(48)))

    assignee = relationship("User", foreign_keys=[assignee_id], lazy="joined")
    reporter = relationship("User", foreign_keys=[reporter_id])
    customer = relationship("Customer", lazy="joined")


class Order(Base, TimestampMixin, SoftDeleteMixin, MetadataMixin):
    __tablename__ = "orders"

    id: Mapped[UUID] = uuid_pk()
    reference: Mapped[str] = mapped_column(String(24), nullable=False, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(24), default="PENDING", index=True)
    payment_status: Mapped[str] = mapped_column(String(24), default="UNPAID", index=True)
    fulfilment_status: Mapped[str] = mapped_column(String(24), default="PENDING", index=True)
    channel: Mapped[str] = mapped_column(String(24), default="DIRECT", index=True)

    customer_id: Mapped[UUID | None] = fk("customers.id")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    owner_id: Mapped[UUID | None] = fk("users.id")
    region_id: Mapped[UUID | None] = fk("regions.id")
    department_id: Mapped[UUID | None] = fk("departments.id")

    placed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    shipped_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    subtotal: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    tax: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    shipping: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    discount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    total: Mapped[float] = mapped_column(Numeric(14, 2), default=0, index=True)
    currency: Mapped[str] = mapped_column(String(8), default="EUR")
    item_count: Mapped[int] = mapped_column(Integer, default=0)
    #: Line items inline: an order detail page reads them whole, always, and a
    #: separate table would be one join for no query anyone actually runs.
    items: Mapped[list[Any] | None] = mapped_column(JSONB)
    notes: Mapped[str | None] = mapped_column(Text)

    customer = relationship("Customer", lazy="joined")
    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")


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
    board_position: Mapped[int] = mapped_column(Integer, default=0, index=True)
    blocked_reason: Mapped[str | None] = mapped_column(String(240))
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String(48)))
    checklist: Mapped[list[Any] | None] = mapped_column(JSONB)

    project = relationship("Project", back_populates="tasks")
    assignee = relationship("User", foreign_keys=[assignee_id], lazy="joined")
    requester = relationship("User", foreign_keys=[requester_id])
    parent = relationship("Task", remote_side="Task.id", backref="subtasks")


class Device(Base, TimestampMixin, SoftDeleteMixin, MetadataMixin):
    """Managed hardware — the entity list with live telemetry and a health
    state, which is what makes the monitoring layouts of §61 concrete."""

    __tablename__ = "devices"

    id: Mapped[UUID] = uuid_pk()
    serial: Mapped[str] = mapped_column(String(48), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), default="SENSOR", index=True)
    model: Mapped[str | None] = mapped_column(String(96), index=True)
    manufacturer: Mapped[str | None] = mapped_column(String(96), index=True)
    status: Mapped[str] = mapped_column(String(24), default="ONLINE", index=True)
    firmware: Mapped[str | None] = mapped_column(String(32))
    ip_address: Mapped[str | None] = mapped_column(String(64))
    location: Mapped[str | None] = mapped_column(String(160), index=True)
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    region_id: Mapped[UUID | None] = fk("regions.id")
    owner_id: Mapped[UUID | None] = fk("users.id")
    project_id: Mapped[UUID | None] = fk("projects.id")
    last_seen_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    battery_percent: Mapped[int | None] = mapped_column(Integer)
    signal_strength: Mapped[int | None] = mapped_column(Integer)
    uptime_hours: Mapped[int] = mapped_column(Integer, default=0)
    error_count: Mapped[int] = mapped_column(Integer, default=0, index=True)
    warranty_until: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String(48)))

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")
    organization = relationship("Organization", lazy="joined")


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
