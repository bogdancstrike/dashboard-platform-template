"""Contracts and renewals."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Double,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


class Contract(Base, TimestampMixin, SoftDeleteMixin):
    """A customer agreement with an end date, worked as a renewal."""

    __tablename__ = "contracts"
    __table_args__ = (Index("ix_contract_stage_end", "stage", "end_date"),)

    id: Mapped[UUID] = uuid_pk()
    reference: Mapped[str] = mapped_column(String(24), nullable=False, unique=True, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    customer_id: Mapped[UUID] = fk("customers.id", ondelete="CASCADE", nullable=False)
    owner_id: Mapped[UUID | None] = fk("users.id")
    #: Annual recurring revenue.
    value: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="EUR", nullable=False)
    start_date: Mapped[Any] = mapped_column(Date, nullable=False)
    end_date: Mapped[Any] = mapped_column(Date, nullable=False, index=True)
    term_months: Mapped[int] = mapped_column(Integer, default=12, nullable=False)
    billing: Mapped[str] = mapped_column(String(16), default="ANNUAL", nullable=False)
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=False)
    notice_days: Mapped[int] = mapped_column(Integer, default=60)
    #: UPCOMING → NEGOTIATION → COMMITTED → RENEWED | CHURNED
    stage: Mapped[str] = mapped_column(String(16), default="UPCOMING", nullable=False, index=True)
    probability: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    #: Order within a stage on the board.
    rank: Mapped[float] = mapped_column(Double, default=0, nullable=False)
    terms: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    churn_reason: Mapped[str | None] = mapped_column(String(200))
    stage_changed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    #: Where its documents live — created on the first upload.
    folder_id: Mapped[UUID | None] = fk("folders.id")

    customer = relationship("Customer", lazy="joined")
    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")
