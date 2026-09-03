"""Identity, org structure, and authorization (§11, §12, §13, §41, §42).

The org graph is deliberately four levels — organization → department → team,
with region as an orthogonal axis — because that is the shape almost every
enterprise dataset ends up needing, and a template that only models one level
forces the first real project to migrate on day one.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Table, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, MetadataMixin, SoftDeleteMixin, TimestampMixin, fk, uuid_pk

# ── association tables ───────────────────────────────────────────────────

user_groups = Table(
    "user_groups",
    Base.metadata,
    Column("user_id", PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("group_id", PgUUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True),
)


class Organization(Base, TimestampMixin, SoftDeleteMixin, MetadataMixin):
    __tablename__ = "organizations"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    legal_name: Mapped[str | None] = mapped_column(String(200))
    industry: Mapped[str | None] = mapped_column(String(80), index=True)
    tier: Mapped[str] = mapped_column(String(24), default="STANDARD", index=True)
    status: Mapped[str] = mapped_column(String(24), default="ACTIVE", index=True)
    region_id: Mapped[UUID | None] = fk("regions.id")
    #: Kept as a data URI in the template so the file store stays optional.
    logo_url: Mapped[str | None] = mapped_column(Text)
    website: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(48))
    address_line: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str | None] = mapped_column(String(96), index=True)
    country: Mapped[str | None] = mapped_column(String(96), index=True)
    employee_count: Mapped[int] = mapped_column(Integer, default=0)
    annual_revenue: Mapped[float] = mapped_column(default=0.0)
    #: Org-level defaults + security policy + retention (§42), one document so
    #: adding a policy knob never needs a migration.
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    region = relationship("Region", lazy="joined")
    departments = relationship("Department", back_populates="organization", cascade="all, delete-orphan")
    users = relationship("User", back_populates="organization", foreign_keys="User.organization_id")


class Region(Base, TimestampMixin):
    __tablename__ = "regions"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(96), nullable=False, unique=True)
    code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    currency: Mapped[str] = mapped_column(String(8), default="EUR")


class Department(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "departments"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    organization_id: Mapped[UUID | None] = fk("organizations.id", ondelete="CASCADE")
    #: Self-reference so the hierarchical selector (§9) has real depth to show.
    parent_id: Mapped[UUID | None] = fk("departments.id")
    manager_id: Mapped[UUID | None] = fk("users.id")
    cost_center: Mapped[str | None] = mapped_column(String(32))
    headcount: Mapped[int] = mapped_column(Integer, default=0)

    organization = relationship("Organization", back_populates="departments")
    parent = relationship("Department", remote_side="Department.id", backref="children")
    manager = relationship("User", foreign_keys=[manager_id], lazy="joined")


class Team(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "teams"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    organization_id: Mapped[UUID | None] = fk("organizations.id", ondelete="CASCADE")
    department_id: Mapped[UUID | None] = fk("departments.id")
    lead_id: Mapped[UUID | None] = fk("users.id")
    color: Mapped[str] = mapped_column(String(16), default="#5b5bd6")


class Role(Base, TimestampMixin):
    """A named permission bundle. Permissions live in an array column rather
    than a join table: the set is small, always read whole, and this makes the
    permission matrix (§13) one row per query instead of N."""

    __tablename__ = "roles"

    id: Mapped[UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(48), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(96), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    permissions: Mapped[list[str]] = mapped_column(ARRAY(String(64)), default=list)
    rank: Mapped[int] = mapped_column(Integer, default=0, index=True)
    color: Mapped[str] = mapped_column(String(16), default="#64748b")
    #: System roles cannot be deleted; the UI disables the action rather than
    #: letting the request fail at the database.
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    users = relationship("User", back_populates="role")


class Group(Base, TimestampMixin, SoftDeleteMixin):
    """Additive permission bundles independent of role — the mechanism behind
    "everyone in the on-call group may cancel jobs"."""

    __tablename__ = "groups"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(24), default="TEAM", index=True)
    permissions: Mapped[list[str]] = mapped_column(ARRAY(String(64)), default=list)
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    color: Mapped[str] = mapped_column(String(16), default="#0891b2")

    members = relationship("User", secondary=user_groups, back_populates="groups")


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
