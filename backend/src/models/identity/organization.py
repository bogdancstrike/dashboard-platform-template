"""Organizations, regions, departments, teams, roles and groups."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Table, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import (
    Base,
    MetadataMixin,
    SoftDeleteMixin,
    TimestampMixin,
    fk,
    uuid_pk,
)

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
