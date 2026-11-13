"""Metric watches and the anomalies they flag."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    DateTime,
    Double,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


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
