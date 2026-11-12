"""Service-level policies: which tickets, what targets, whose hours.

A ticket's deadline used to be a number the seed made up from its severity.
These tables make it a *policy*: the first active policy whose conditions match
a ticket (customer, segment, category, channel) sets per-priority targets for
the first response and for resolution, counted in the business hours of its
calendar, paused while the ticket waits on the customer, with escalation steps
at a share of the target.

`ticket_sla` is the computed answer for one ticket — which policy applied, the
two deadlines, how long the clock has been paused and which escalation steps
have fired — kept beside the ticket rather than on it, because it is derived
and `services/sla` is its only writer. `tickets.due_at` and `sla_breached` are
still written, from it, so every report that already reads them agrees.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


class BusinessCalendar(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "business_calendars"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", nullable=False)
    #: {"mon": [["09:00", "17:00"]], …, "sun": []} — a day with no spans is closed.
    hours: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: [{"date": "2026-12-25", "name": "Christmas Day"}]
    holidays: Mapped[list[Any] | None] = mapped_column(JSONB)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)


class SlaPolicy(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "sla_policies"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    #: Evaluation order: the first active match wins.
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    #: {"segment": [...], "category": [...], "channel": [...], "customer_ids": [...]}
    #: — every named key must match; an empty object matches every ticket.
    conditions: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: {"CRITICAL": {"first_response": 30, "resolution": 240}, …} in business minutes.
    targets: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    calendar_id: Mapped[UUID | None] = fk("business_calendars.id")
    #: Ticket statuses during which the clock stops.
    pause_statuses: Mapped[list[Any] | None] = mapped_column(JSONB)
    #: [{"at_percent": 75, "action": "NOTIFY", "target": "assignee"}, …]
    escalations: Mapped[list[Any] | None] = mapped_column(JSONB)

    calendar = relationship("BusinessCalendar", lazy="joined")


class TicketSla(Base, TimestampMixin):
    __tablename__ = "ticket_sla"
    __table_args__ = (UniqueConstraint("ticket_id", name="uq_ticket_sla_ticket_id"),)

    id: Mapped[UUID] = uuid_pk()
    ticket_id: Mapped[UUID] = fk("tickets.id", nullable=False, ondelete="CASCADE", index=False)
    policy_id: Mapped[UUID | None] = fk("sla_policies.id")
    first_response_due_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    resolution_due_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    #: Business minutes the clock has stood still so far.
    paused_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    paused_since: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    #: Indexes into the policy's escalation list that have already fired.
    escalations_fired: Mapped[list[Any] | None] = mapped_column(JSONB)
    computed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))

    policy = relationship("SlaPolicy", lazy="joined")
