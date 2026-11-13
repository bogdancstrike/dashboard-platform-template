"""Visibility scopes, shares, favourites, recents and notification preferences."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, TimestampMixin, fk, uuid_pk

#: Visibility, shared by saved searches, views, reports and dashboards (§5).
#:
#: * ``PRIVATE`` — the owner only. **The default**: nothing is shared by accident.
#: * ``SHARED``  — the owner plus the people named in ``resource_shares``.
#: * ``PUBLIC``  — anyone signed in.
#:
#: ``TEAM`` and ``ORGANIZATION`` remain for views and dashboards, where "everyone
#: in my department" is the natural audience and naming people one by one is not.
#:
#: Whatever the scope, **only the owner may edit, re-share or delete.** A member
#: who wants their own version duplicates it, and the copy is theirs and private.
SCOPES = ("PRIVATE", "SHARED", "TEAM", "ORGANIZATION", "PUBLIC")


#: Scopes that mean "resolve the audience from `resource_shares`".
MEMBER_SCOPES = ("SHARED",)


class ResourceShare(Base, TimestampMixin):
    """Explicit per-user access to something somebody else owns (§5).

    Polymorphic, like comments, tags and favourites, so saved searches, saved
    views, dashboards and reports all share one mechanism rather than each
    growing a join table and its own rules.

    A share grants **read**, never write. That is not a limitation waiting to be
    lifted: "only the owner may edit or delete" is the rule, and a `permission`
    column that could say otherwise would be an invitation to break it. The
    column exists so the grant is legible in the data, not so it can vary.

    Rows survive a flip to `PUBLIC` and back — otherwise making a search public
    for an afternoon would silently destroy the audience it had before.
    """

    __tablename__ = "resource_shares"
    __table_args__ = (
        UniqueConstraint(
            "resource_type", "resource_id", "user_id", name="uq_resource_share"
        ),
        Index("ix_resource_share_lookup", "user_id", "resource_type"),
    )

    id: Mapped[UUID] = uuid_pk()
    resource_type: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    resource_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    #: The person being given access.
    user_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    #: The owner who granted it, kept for the audit trail (§21).
    shared_by_id: Mapped[UUID | None] = fk("users.id")
    permission: Mapped[str] = mapped_column(String(16), default="VIEW", nullable=False)

    user = relationship("User", foreign_keys=[user_id], lazy="joined")


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
