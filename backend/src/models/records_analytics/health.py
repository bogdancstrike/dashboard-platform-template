"""The health model, customer health and its snapshots."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Index,
    Integer,
    String,
    UniqueConstraint,
    select,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, column_property, mapped_column, relationship

from src.models.base import Base, TimestampMixin, fk, uuid_pk
from src.models.business import Customer


class HealthModel(Base, TimestampMixin):
    """The weights and thresholds the score is computed with.

    One active row. Kept as a table rather than a system setting because it
    is versioned in practice — "the score dropped" is often "the model
    changed", and `updated_by`/`updated_at` plus the audit row answer which.
    """

    __tablename__ = "health_models"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120), nullable=False, default="Default")
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    #: {"tickets": 30, "orders": 30, "usage": 25, "renewal": 15}
    weights: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    #: Band cut-offs and per-signal parameters — see `services/customer_health`.
    thresholds: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    updated_by_id: Mapped[UUID | None] = fk("users.id")


class CustomerHealth(Base, TimestampMixin):
    """The current score of one customer, and why."""

    __tablename__ = "customer_health"

    id: Mapped[UUID] = uuid_pk()
    customer_id: Mapped[UUID] = fk("customers.id", ondelete="CASCADE", nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    #: HEALTHY · AT_RISK · CRITICAL
    band: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    #: The band before the last recompute that changed it, for "dropped from…".
    previous_band: Mapped[str | None] = mapped_column(String(16))
    band_changed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    #: Score movement over the last 7 and 30 days, from the snapshots.
    delta_7d: Mapped[int | None] = mapped_column(Integer, index=True)
    delta_30d: Mapped[int | None] = mapped_column(Integer, index=True)
    #: Per signal: {score, weight, contribution, facts: [...], inputs: {...}}
    components: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    computed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)

    __table_args__ = (UniqueConstraint("customer_id", name="uq_customer_health_customer"),)

    customer = relationship("Customer", lazy="joined")


class CustomerHealthSnapshot(Base):
    """One customer's score on one day — the trend line's points."""

    __tablename__ = "customer_health_snapshots"
    __table_args__ = (
        UniqueConstraint("customer_id", "day", name="uq_health_snapshot_day"),
        Index("ix_health_snapshot_day", "day"),
    )

    id: Mapped[UUID] = uuid_pk()
    customer_id: Mapped[UUID] = fk("customers.id", ondelete="CASCADE", nullable=False)
    day: Mapped[Any] = mapped_column(Date, nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    band: Mapped[str] = mapped_column(String(16), nullable=False)
    #: The four sub-scores, so a trend can be read per signal too.
    components: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


# The current score and band ride along on every `Customer` load as correlated
# scalar subqueries — which is what lets the explorer declare them as ordinary
# fields: the customers list filters, sorts and facets by health in PostgreSQL
# with no join written anywhere else, and a row without a score reads as null.
Customer.health_score = column_property(  # type: ignore[attr-defined]
    select(CustomerHealth.score)
    .where(CustomerHealth.customer_id == Customer.id)
    .correlate_except(CustomerHealth)
    .scalar_subquery()
)


Customer.health_band = column_property(  # type: ignore[attr-defined]
    select(CustomerHealth.band)
    .where(CustomerHealth.customer_id == Customer.id)
    .correlate_except(CustomerHealth)
    .scalar_subquery()
)
