"""Customers, their orders and support tickets."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import (
    Base,
    MetadataMixin,
    SoftDeleteMixin,
    TimestampMixin,
    fk,
    uuid_pk,
)


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
    #: Added when tags shipped (§37). The other five entity tables had it and
    #: this one did not, which made orders the one dataset a shared vocabulary
    #: could not be applied to — an asymmetry with no reason behind it, and one
    #: nothing would have reported. `--sync-schema` adds the column to a
    #: database that predates this line.
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String(48)))

    customer = relationship("Customer", lazy="joined")
    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")
