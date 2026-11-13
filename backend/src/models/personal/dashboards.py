"""Dashboards and their widgets."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


class Dashboard(Base, TimestampMixin, SoftDeleteMixin):
    """A widget layout (§45, §67)."""

    __tablename__ = "dashboards"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    owner_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    scope: Mapped[str] = mapped_column(String(16), default="PRIVATE", index=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_home: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    icon: Mapped[str | None] = mapped_column(String(48))
    #: Saved dashboard-level filter state, so opening a dashboard restores the
    #: period and scope it was last read under.
    filters: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    columns: Mapped[int] = mapped_column(Integer, default=12)

    widgets = relationship(
        "DashboardWidget", back_populates="dashboard", cascade="all, delete-orphan",
        order_by="DashboardWidget.position",
    )
    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")


class DashboardWidget(Base, TimestampMixin):
    __tablename__ = "dashboard_widgets"

    id: Mapped[UUID] = uuid_pk()
    dashboard_id: Mapped[UUID | None] = fk("dashboards.id", ondelete="CASCADE")
    kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    subtitle: Mapped[str | None] = mapped_column(String(240))
    #: Grid geometry, in a 12-column layout.
    x: Mapped[int] = mapped_column(Integer, default=0)
    y: Mapped[int] = mapped_column(Integer, default=0)
    width: Mapped[int] = mapped_column(Integer, default=3)
    height: Mapped[int] = mapped_column(Integer, default=1)
    position: Mapped[int] = mapped_column(Integer, default=0, index=True)
    #: Widget-specific settings: metric key, chart type, entity, filters.
    config: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    dashboard = relationship("Dashboard", back_populates="widgets")
