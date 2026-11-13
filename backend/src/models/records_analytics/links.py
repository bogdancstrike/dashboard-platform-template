"""Public, embeddable dashboard links."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, TimestampMixin, fk, uuid_pk


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
