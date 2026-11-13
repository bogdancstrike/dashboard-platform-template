"""Feature flags, system settings, integrations and service health."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


class FeatureFlag(Base, TimestampMixin):
    """Feature flags with percentage and targeted rollout (§27)."""

    __tablename__ = "feature_flags"

    id: Mapped[UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String(96), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    environment: Mapped[str] = mapped_column(String(24), default="production", index=True)
    stage: Mapped[str] = mapped_column(String(24), default="BETA", index=True)
    rollout_percentage: Mapped[int] = mapped_column(Integer, default=0)
    target_user_ids: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    target_group_ids: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    target_roles: Mapped[list[str] | None] = mapped_column(ARRAY(String(48)))
    #: Organizations that always have the flag (§27 targeting).
    target_organization_ids: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    owner_id: Mapped[UUID | None] = fk("users.id")
    updated_by_id: Mapped[UUID | None] = fk("users.id")
    last_toggled_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    #: Marks a flag as experimental so navigation can badge the feature (§1).
    experimental: Mapped[bool] = mapped_column(Boolean, default=False, index=True)


class Integration(Base, TimestampMixin, SoftDeleteMixin):
    """A configured external system (§26)."""

    __tablename__ = "integrations"

    id: Mapped[UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(32), default="API", index=True)
    description: Mapped[str | None] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    status: Mapped[str] = mapped_column(String(24), default="NOT_CONFIGURED", index=True)
    health: Mapped[str] = mapped_column(String(24), default="UNKNOWN", index=True)
    last_connected_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    last_error: Mapped[str | None] = mapped_column(Text)
    last_error_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    #: Non-secret settings only. Secret values are referenced by name and live
    #: in the deployment's secret store, never in this row.
    configuration: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    required_settings: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    icon: Mapped[str | None] = mapped_column(String(48))
    docs_url: Mapped[str | None] = mapped_column(String(300))
    owner_id: Mapped[UUID | None] = fk("users.id")


class SystemSetting(Base, TimestampMixin):
    """Runtime configuration (§11). One row per key so an audit entry can name
    exactly what changed, rather than diffing one giant document."""

    __tablename__ = "system_settings"

    id: Mapped[UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String(96), nullable=False, unique=True, index=True)
    category: Mapped[str] = mapped_column(String(48), default="general", index=True)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    value: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    default_value: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    value_type: Mapped[str] = mapped_column(String(24), default="string")
    #: Rendering hints for the settings form (choices, min/max, help).
    options: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    is_secret: Mapped[bool] = mapped_column(Boolean, default=False)
    requires_restart: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_by_id: Mapped[UUID | None] = fk("users.id")


class ServiceHealth(Base, TimestampMixin):
    """Last known state of each monitored dependency (§24)."""

    __tablename__ = "service_health"

    id: Mapped[UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(String(32), default="SERVICE", index=True)
    status: Mapped[str] = mapped_column(String(24), default="UNKNOWN", index=True)
    latency_ms: Mapped[float | None] = mapped_column(Numeric(10, 2))
    error_rate: Mapped[float] = mapped_column(Numeric(6, 3), default=0)
    request_volume: Mapped[int] = mapped_column(Integer, default=0)
    uptime_percent: Mapped[float] = mapped_column(Numeric(6, 3), default=100)
    last_checked_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    message: Mapped[str | None] = mapped_column(String(400))
    #: A short history so the health page can draw a sparkline per service.
    history: Mapped[list[Any] | None] = mapped_column(JSONB)
