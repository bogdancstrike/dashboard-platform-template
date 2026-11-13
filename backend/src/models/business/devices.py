"""The device fleet."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import (
    Base,
    MetadataMixin,
    SoftDeleteMixin,
    TimestampMixin,
    fk,
    uuid_pk,
)


class Device(Base, TimestampMixin, SoftDeleteMixin, MetadataMixin):
    """Managed hardware — the entity list with live telemetry and a health
    state, which is what gives `/devices` a fleet view worth building (§7)."""

    __tablename__ = "devices"

    id: Mapped[UUID] = uuid_pk()
    serial: Mapped[str] = mapped_column(String(48), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), default="SENSOR", index=True)
    model: Mapped[str | None] = mapped_column(String(96), index=True)
    manufacturer: Mapped[str | None] = mapped_column(String(96), index=True)
    status: Mapped[str] = mapped_column(String(24), default="ONLINE", index=True)
    firmware: Mapped[str | None] = mapped_column(String(32))
    ip_address: Mapped[str | None] = mapped_column(String(64))
    location: Mapped[str | None] = mapped_column(String(160), index=True)
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    region_id: Mapped[UUID | None] = fk("regions.id")
    owner_id: Mapped[UUID | None] = fk("users.id")
    project_id: Mapped[UUID | None] = fk("projects.id")
    last_seen_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    battery_percent: Mapped[int | None] = mapped_column(Integer)
    signal_strength: Mapped[int | None] = mapped_column(Integer)
    uptime_hours: Mapped[int] = mapped_column(Integer, default=0)
    error_count: Mapped[int] = mapped_column(Integer, default=0, index=True)
    warranty_until: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String(48)))

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")
    organization = relationship("Organization", lazy="joined")
