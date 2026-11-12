"""Insights (§43): a question about the records, answered as a small generated page.

The row keeps the *spec* — components and the queries behind them — and the
last *rendered* copy with the data bound in. Refreshing re-runs the queries;
it never asks the model again.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


class Insight(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "insights"

    id: Mapped[UUID] = uuid_pk()
    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    #: The datasets the queries read, for the gallery's filter.
    datasets: Mapped[list[Any] | None] = mapped_column(JSONB)
    spec: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    rendered: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    warnings: Mapped[list[Any] | None] = mapped_column(JSONB)
    #: `ai` (the model wrote it), `suggested` (a hand-written one) or `fallback`.
    source: Mapped[str] = mapped_column(String(16), default="ai", index=True)
    model: Mapped[str | None] = mapped_column(String(80))
    usage: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    scope: Mapped[str] = mapped_column(String(16), default="PRIVATE", index=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    refreshed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    owner_id: Mapped[UUID | None] = fk("users.id")
    organization_id: Mapped[UUID | None] = fk("organizations.id")

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")
