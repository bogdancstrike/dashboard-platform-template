"""Personalization: saved searches, views, favorites, recents, dashboards.

These tables are what make the platform feel like it remembers you (§5, §38,
§39, §45, §46, §67). All of them share one shape — a JSONB payload plus a
sharing scope — because "who can see this" is the only hard question in the
group, and answering it once is what keeps five features consistent.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk

#: Visibility ladder shared by saved searches, views, reports and dashboards.
#: PRIVATE < TEAM < ORGANIZATION < PUBLIC, and a query filters with `IN` over
#: the levels the caller can reach rather than a per-feature special case.
SCOPES = ("PRIVATE", "TEAM", "ORGANIZATION", "PUBLIC")


class SavedSearch(Base, TimestampMixin, SoftDeleteMixin):
    """A named advanced query (§5), with the presentation it was saved under.

    Storing columns/sort/page size beside the conditions is deliberate: opening
    a saved search that finds the right rows and then shows the wrong columns
    is a saved search nobody trusts.
    """

    __tablename__ = "saved_searches"
    __table_args__ = (Index("ix_saved_search_owner_scope", "owner_id", "scope"),)

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    resource_type: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    owner_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    team_id: Mapped[UUID | None] = fk("teams.id")
    scope: Mapped[str] = mapped_column(String(16), default="PRIVATE", index=True)
    #: The react-awesome-query-builder tree, compiled by `core/rules.py`.
    condition_tree: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: Human rendering for the query inspector and for list cards (§51).
    condition_text: Mapped[str | None] = mapped_column(Text)
    #: Plain query params, for searches saved from the simple filter bar.
    filters: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    query_text: Mapped[str | None] = mapped_column(String(500))
    sort: Mapped[str | None] = mapped_column(String(120))
    order: Mapped[str] = mapped_column(String(8), default="desc")
    columns: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    page_size: Mapped[int] = mapped_column(Integer, default=25)
    view_mode: Mapped[str] = mapped_column(String(16), default="table")
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    rule_count: Mapped[int] = mapped_column(Integer, default=0)
    use_count: Mapped[int] = mapped_column(Integer, default=0, index=True)
    last_used_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")


class SavedView(Base, TimestampMixin, SoftDeleteMixin):
    """A saved *page configuration* (§46) — filters, columns, order, grouping.

    Distinct from a saved search: a search is a question, a view is how the
    answer is laid out. The same question is read differently by an analyst and
    by an operator.
    """

    __tablename__ = "saved_views"
    __table_args__ = (Index("ix_saved_view_resource_owner", "resource_type", "owner_id"),)

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    resource_type: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    owner_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    team_id: Mapped[UUID | None] = fk("teams.id")
    scope: Mapped[str] = mapped_column(String(16), default="PRIVATE", index=True)
    filters: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    condition_tree: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    columns: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    column_widths: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    pinned_columns: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    sort: Mapped[str | None] = mapped_column(String(120))
    order: Mapped[str] = mapped_column(String(8), default="desc")
    group_by: Mapped[str | None] = mapped_column(String(64))
    page_size: Mapped[int] = mapped_column(Integer, default=25)
    density: Mapped[str] = mapped_column(String(16), default="middle")
    view_mode: Mapped[str] = mapped_column(String(16), default="table")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    use_count: Mapped[int] = mapped_column(Integer, default=0)

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")


class Favorite(Base, TimestampMixin):
    """A bookmark on anything addressable (§38)."""

    __tablename__ = "favorites"
    __table_args__ = (
        UniqueConstraint("user_id", "resource_type", "resource_id", name="uq_favorite"),
    )

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    resource_type: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    resource_id: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(240), nullable=False)
    #: The in-app route. Stored rather than derived so a favourite keeps
    #: working when a route's shape changes for new records only.
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(48))
    position: Mapped[int] = mapped_column(Integer, default=0, index=True)


class RecentItem(Base, TimestampMixin):
    """Recently visited entities, searches, reports and pages (§39, §68)."""

    __tablename__ = "recent_items"
    __table_args__ = (
        UniqueConstraint("user_id", "resource_type", "resource_id", name="uq_recent"),
        Index("ix_recent_user_time", "user_id", "visited_at"),
    )

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    resource_type: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    resource_id: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(240), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(48))
    visited_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    visit_count: Mapped[int] = mapped_column(Integer, default=1)


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


class Report(Base, TimestampMixin, SoftDeleteMixin):
    """A saved report definition (§28) — dimensions, metrics, filters, chart."""

    __tablename__ = "reports"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    resource_type: Mapped[str] = mapped_column(String(48), default="order", index=True)
    owner_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    scope: Mapped[str] = mapped_column(String(16), default="PRIVATE", index=True)
    dimensions: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    metrics: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    filters: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    condition_tree: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    group_by: Mapped[str | None] = mapped_column(String(64))
    sort: Mapped[str | None] = mapped_column(String(64))
    order: Mapped[str] = mapped_column(String(8), default="desc")
    period: Mapped[str] = mapped_column(String(32), default="last_30_days")
    visualization: Mapped[str] = mapped_column(String(24), default="bar", index=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    last_run_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    run_count: Mapped[int] = mapped_column(Integer, default=0)
    schedule: Mapped[str | None] = mapped_column(String(64))

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")


class NotificationPreference(Base, TimestampMixin):
    """Per-user, per-category delivery settings (§17, §40)."""

    __tablename__ = "notification_preferences"
    __table_args__ = (UniqueConstraint("user_id", "category", name="uq_notif_pref"),)

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    in_app: Mapped[bool] = mapped_column(Boolean, default=True)
    email: Mapped[bool] = mapped_column(Boolean, default=False)
    push: Mapped[bool] = mapped_column(Boolean, default=False)
    digest: Mapped[str] = mapped_column(String(16), default="INSTANT")
    quiet_hours_start: Mapped[str | None] = mapped_column(String(8))
    quiet_hours_end: Mapped[str | None] = mapped_column(String(8))
