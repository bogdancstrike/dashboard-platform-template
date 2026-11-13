"""Onboarding (§38): per-person checklist progress, and the tags on sample data.

* `onboarding_steps` — one row per person and step they have marked done or
  skipped (or the card they dismissed). Steps that tick themselves off are
  *derived* from what the person has actually done and need no row.
* `sample_records` — every record a "load sample data" created, by area and
  batch. Removing sample data deletes exactly these ids, so real data is never
  touched; the table is the tag.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base, TimestampMixin, fk, uuid_pk


class OnboardingStep(Base, TimestampMixin):
    """A person's own answer to one checklist step: DONE, SKIPPED or DISMISSED."""

    __tablename__ = "onboarding_steps"
    __table_args__ = (UniqueConstraint("user_id", "step_key", name="uq_onboarding_step"),)

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = fk("users.id", ondelete="CASCADE", nullable=False)
    step_key: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    completed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))


class SampleRecord(Base, TimestampMixin):
    """One record created by loading sample data — the tag that makes it removable."""

    __tablename__ = "sample_records"
    __table_args__ = (Index("ix_sample_area_type", "area", "resource_type"),)

    id: Mapped[UUID] = uuid_pk()
    area: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    batch_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(48), nullable=False)
    record_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    label: Mapped[str | None] = mapped_column(String(240))
    created_by_id: Mapped[UUID | None] = fk("users.id")
