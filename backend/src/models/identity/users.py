"""Users, their sessions, sign-ins and security events."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import (
    Base,
    MetadataMixin,
    SoftDeleteMixin,
    TimestampMixin,
    fk,
    uuid_pk,
)
from src.models.identity.organization import (
    user_groups,
)


class User(Base, TimestampMixin, SoftDeleteMixin, MetadataMixin):
    __tablename__ = "users"

    id: Mapped[UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    username: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    first_name: Mapped[str | None] = mapped_column(String(80))
    last_name: Mapped[str | None] = mapped_column(String(80))
    #: Initials-based SVG data URI in the seed — no external avatar service, so
    #: the demo renders identically offline.
    avatar_url: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(String(48))
    job_title: Mapped[str | None] = mapped_column(String(120), index=True)
    #: The Keycloak subject (`sub`). Keycloak owns credentials — this table
    #: holds no password of any kind — so this is the only link between a realm
    #: identity and its platform profile. Nullable because most seeded demo
    #: users exist only here until (and unless) someone signs in as them.
    external_id: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)

    organization_id: Mapped[UUID | None] = fk("organizations.id")
    department_id: Mapped[UUID | None] = fk("departments.id")
    team_id: Mapped[UUID | None] = fk("teams.id")
    manager_id: Mapped[UUID | None] = fk("users.id")
    role_id: Mapped[UUID | None] = fk("roles.id")

    status: Mapped[str] = mapped_column(String(24), default="ACTIVE", index=True)
    locale: Mapped[str] = mapped_column(String(12), default="en-US")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    last_login_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    login_count: Mapped[int] = mapped_column(Integer, default=0)
    #: Mirrors the realm's MFA state for display on the security page; the
    #: realm remains the place it is actually configured.
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    mfa_method: Mapped[str | None] = mapped_column(String(24))
    #: Drives the data-quality indicators of §65 without recomputing per row.
    profile_completeness: Mapped[int] = mapped_column(Integer, default=100, index=True)
    #: Personal preferences (§40) — appearance, formats, densities, defaults.
    preferences: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    role = relationship("Role", back_populates="users", lazy="joined")
    organization = relationship("Organization", back_populates="users", foreign_keys=[organization_id])
    department = relationship("Department", foreign_keys=[department_id], lazy="joined")
    manager = relationship("User", remote_side="User.id", foreign_keys=[manager_id])
    groups = relationship("Group", secondary=user_groups, back_populates="members")

    @property
    def initials(self) -> str:
        parts = [p for p in (self.full_name or "").split() if p]
        return "".join(p[0] for p in parts[:2]).upper() or (self.username or "?")[:2].upper()


class UserSession(Base, TimestampMixin):
    """An active sign-in (§41). Revocation is a row update, so a revoked
    session is refused on its next request even though the JWT is still
    cryptographically valid until it expires."""

    __tablename__ = "user_sessions"

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    token_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(400))
    device: Mapped[str | None] = mapped_column(String(64), index=True)
    location: Mapped[str | None] = mapped_column(String(120))
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    trusted: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    revoked_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    last_seen_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    expires_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))

    user = relationship("User", lazy="joined")


class LoginEvent(Base, TimestampMixin):
    """Login history (§41), kept separate from the audit log so a user can be
    shown their own sign-ins without granting them `audit.view`."""

    __tablename__ = "login_events"

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    email: Mapped[str | None] = mapped_column(String(255), index=True)
    result: Mapped[str] = mapped_column(String(24), default="SUCCESS", index=True)
    reason: Mapped[str | None] = mapped_column(String(120))
    ip_address: Mapped[str | None] = mapped_column(String(64), index=True)
    user_agent: Mapped[str | None] = mapped_column(String(400))
    device: Mapped[str | None] = mapped_column(String(64))
    location: Mapped[str | None] = mapped_column(String(120))
    method: Mapped[str] = mapped_column(String(24), default="PASSWORD")

    user = relationship("User", lazy="joined")


class SecurityEvent(Base, TimestampMixin):
    """Security-relevant occurrences surfaced on the user's security page and
    on the dashboard alert strip (§41, §66)."""

    __tablename__ = "security_events"

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    kind: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(16), default="INFO", index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    user = relationship("User", lazy="joined")
