"""Records & analytics: customer health, contracts, metric watches, public links.

Four features share this module because they share a theme — reading the
records the platform already holds and saying something about them — and
because each owns only a handful of tables:

* **Customer health (§12).** A weighted model (`HealthModel`, one active row)
  turns tickets, orders, usage and renewal proximity into a 0–100 score.
  `CustomerHealth` is the *current* answer per customer, recomputed in bulk;
  `CustomerHealthSnapshot` is one row per customer per day, which is what the
  trend line and the portfolio's movers are drawn from.
* **Contracts (§13).** The customer renewals the design mentions, as records:
  value, term, owner, a pipeline stage and a probability. Their history is
  the audit trail (`resource_type = "contract"`), which is also what record
  version history reads — so a contract has versions the same way a ticket
  does, with no second ledger.
* **Metric watches (§22).** "Watch this number and tell me when it does
  something unusual": a dataset, a measure, filters and a granularity, a
  detection method and a sensitivity. `MetricAnomaly` is one flagged point,
  with the window it was judged against, so the alert page can redraw the
  chart exactly as the detector saw it.
* **Public dashboard links (§25).** A read-only token for one dashboard, with
  an optional password, an expiry, allowed embedding origins and a view count.

Record version history (§17) and the bulk-edit grid (§18) need no tables: the
first reads `audit_logs`, the second writes through the bulk API.
"""

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
    UniqueConstraint,
    select,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, column_property, mapped_column, relationship

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk
from src.models.business import Customer

# ── customer health (§12) ────────────────────────────────────────────────


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


# ── contracts and renewals (§13) ─────────────────────────────────────────


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


# ── metric watches and anomalies (§22) ───────────────────────────────────


class MetricWatch(Base, TimestampMixin, SoftDeleteMixin):
    """A number somebody wants to hear about when it behaves unusually."""

    __tablename__ = "metric_watches"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    #: An explorer dataset key — `ticket`, `order`, …
    dataset: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    #: count · sum · avg
    measure: Mapped[str] = mapped_column(String(16), default="count", nullable=False)
    measure_field: Mapped[str | None] = mapped_column(String(64))
    #: The date the series is bucketed by; the dataset's trend field when empty.
    date_field: Mapped[str | None] = mapped_column(String(64))
    #: Explorer filter arguments, the same shape a list's URL carries.
    filters: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: hour · day · week
    granularity: Mapped[str] = mapped_column(String(8), default="day", nullable=False)
    #: zscore (rolling mean/stddev) · seasonal (same slot in earlier cycles)
    method: Mapped[str] = mapped_column(String(16), default="zscore", nullable=False)
    #: low · medium · high — or `threshold` when set explicitly.
    sensitivity: Mapped[str] = mapped_column(String(8), default="medium", nullable=False)
    threshold: Mapped[float | None] = mapped_column(Double)
    #: both · up · down
    direction: Mapped[str] = mapped_column(String(8), default="both", nullable=False)
    #: How many earlier buckets a point is judged against.
    window: Mapped[int] = mapped_column(Integer, default=14, nullable=False)
    #: in_app · email
    channels: Mapped[list[str] | None] = mapped_column(ARRAY(String(16)))
    #: Who besides the owner is told.
    recipient_ids: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    muted: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    snoozed_until: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    owner_id: Mapped[UUID | None] = fk("users.id")
    last_evaluated_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    #: OK · ANOMALY · NO_DATA · ERROR
    last_status: Mapped[str | None] = mapped_column(String(16), index=True)
    last_value: Mapped[float | None] = mapped_column(Double)
    last_error: Mapped[str | None] = mapped_column(Text)

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")


class MetricAnomaly(Base, TimestampMixin):
    """One point a watch flagged, with the baseline it was judged against."""

    __tablename__ = "metric_anomalies"
    __table_args__ = (
        UniqueConstraint("watch_id", "bucket_at", name="uq_metric_anomaly_bucket"),
        Index("ix_metric_anomaly_watch_time", "watch_id", "bucket_at"),
    )

    id: Mapped[UUID] = uuid_pk()
    watch_id: Mapped[UUID] = fk("metric_watches.id", ondelete="CASCADE", nullable=False)
    bucket_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False)
    value: Mapped[float] = mapped_column(Double, nullable=False)
    expected: Mapped[float] = mapped_column(Double, nullable=False)
    stddev: Mapped[float] = mapped_column(Double, nullable=False)
    zscore: Mapped[float] = mapped_column(Double, nullable=False)
    #: up (spike) · down (drop)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    #: WARNING · CRITICAL
    severity: Mapped[str] = mapped_column(String(16), default="WARNING", nullable=False)
    #: The series around the point as the detector saw it: [{at, value}].
    series: Mapped[list[Any] | None] = mapped_column(JSONB)
    #: OPEN · ACKNOWLEDGED
    status: Mapped[str] = mapped_column(String(16), default="OPEN", nullable=False, index=True)
    notified: Mapped[bool] = mapped_column(Boolean, default=False)
    #: Why nobody was told, when nobody was: snoozed · muted.
    suppressed_reason: Mapped[str | None] = mapped_column(String(16))
    acknowledged_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    acknowledged_by_id: Mapped[UUID | None] = fk("users.id")

    watch = relationship("MetricWatch", lazy="joined")


# ── public dashboard links (§25) ─────────────────────────────────────────


class DashboardLink(Base, TimestampMixin):
    """A read-only, revocable public address for one dashboard."""

    __tablename__ = "dashboard_links"

    id: Mapped[UUID] = uuid_pk()
    dashboard_id: Mapped[UUID] = fk("dashboards.id", ondelete="CASCADE", nullable=False)
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    label: Mapped[str | None] = mapped_column(String(120))
    password_hash: Mapped[str | None] = mapped_column(String(255))
    #: Bumped whenever the password changes, so earlier unlock grants lapse.
    password_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    expires_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    allow_embed: Mapped[bool] = mapped_column(Boolean, default=False)
    allowed_origins: Mapped[list[str] | None] = mapped_column(ARRAY(String(200)))
    view_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_viewed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[UUID | None] = fk("users.id")

    dashboard = relationship("Dashboard", lazy="joined")
    created_by = relationship("User", foreign_keys=[created_by_id], lazy="joined")
