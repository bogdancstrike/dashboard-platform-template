"""One queue for every decision somebody is waiting on (§ Time & decisions).

An approval is a *request* with a requester, a subject and an outcome, and the
same shape whichever feature raised it: a timesheet week, a permission asked
for from a forbidden page, a record edit a rule holds back, a report somebody
wants to publish. The feature that raises one registers a provider
(`services/approvals.register`) that knows who may decide it and what
approving it *does*; this table only remembers that it was asked and answered.

`history` is a JSONB list rather than a table: it is always read whole, with
its request, and never queried across requests — the audit log is the
cross-cutting record, this is the request's own story.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


class ApprovalRequest(Base, TimestampMixin):
    __tablename__ = "approval_requests"
    __table_args__ = (Index("ix_approval_kind_status", "kind", "status"),)

    id: Mapped[UUID] = uuid_pk()
    reference: Mapped[str] = mapped_column(String(24), nullable=False, unique=True, index=True)
    #: Which provider owns it — `timesheet`, `access`, `change`, `report`.
    kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    #: PENDING → APPROVED | REJECTED, or WITHDRAWN by the requester.
    status: Mapped[str] = mapped_column(String(16), default="PENDING", nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    requester_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    #: The person it is routed to first, when there is an obvious one (a
    #: manager for a timesheet). Anybody holding `decide_permission` may still
    #: decide it, so a holiday does not stall the queue.
    assignee_id: Mapped[UUID | None] = fk("users.id")
    decide_permission: Mapped[str] = mapped_column(String(64), nullable=False)
    subject_type: Mapped[str | None] = mapped_column(String(48), index=True)
    subject_id: Mapped[str | None] = mapped_column(String(64), index=True)
    subject_label: Mapped[str | None] = mapped_column(String(240))
    link: Mapped[str | None] = mapped_column(String(500))
    #: What the provider needs to carry out the decision — the patch a change
    #: request holds back, the permission an access request asks for.
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: When an answer is due; the inbox colours age against it.
    due_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    decided_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    decided_by_id: Mapped[UUID | None] = fk("users.id")
    decision_comment: Mapped[str | None] = mapped_column(Text)
    history: Mapped[list[Any] | None] = mapped_column(JSONB)

    requester = relationship("User", foreign_keys=[requester_id], lazy="joined")
    assignee = relationship("User", foreign_keys=[assignee_id], lazy="joined")
    decided_by = relationship("User", foreign_keys=[decided_by_id], lazy="joined")


class ChangeRule(Base, TimestampMixin, SoftDeleteMixin):
    """"An edit to this field needs a second pair of eyes."

    Checked by `services/change_requests` before a record edit is applied. A
    matching edit is not refused: it becomes a change request in the inbox, and
    approving it applies exactly the values that were held back.
    """

    __tablename__ = "change_rules"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    resource_type: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    field: Mapped[str] = mapped_column(String(64), nullable=False)
    #: ANY (any change), EQUALS / IN (the new value), GT / LT (numbers).
    operator: Mapped[str] = mapped_column(String(16), default="ANY", nullable=False)
    value: Mapped[Any | None] = mapped_column(JSONB)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by_id: Mapped[UUID | None] = fk("users.id")
