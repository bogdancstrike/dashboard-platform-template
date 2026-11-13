"""API clients, their credentials and request log."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Index, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


class ApiClient(Base, TimestampMixin, SoftDeleteMixin):
    """A machine consumer (§25)."""

    __tablename__ = "api_clients"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    client_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="ACTIVE", index=True)
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    owner_id: Mapped[UUID | None] = fk("users.id")
    scopes: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    rate_limit_per_minute: Mapped[int] = mapped_column(Integer, default=600)
    quota_per_day: Mapped[int] = mapped_column(Integer, default=100000)
    requests_today: Mapped[int] = mapped_column(Integer, default=0)
    requests_total: Mapped[int] = mapped_column(Integer, default=0)
    error_rate: Mapped[float] = mapped_column(Numeric(6, 3), default=0)
    last_used_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    allowed_ips: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")
    credentials = relationship(
        "ApiCredential", back_populates="client", cascade="all, delete-orphan"
    )


class ApiCredential(Base, TimestampMixin):
    """A secret belonging to an API client.

    Only the hash and a 4-character prefix are stored. The plaintext exists for
    exactly one response, at creation — §76 is a schema decision here, not a UI
    one, because a column that can hold a secret eventually shows one.
    """

    __tablename__ = "api_credentials"

    id: Mapped[UUID] = uuid_pk()
    api_client_id: Mapped[UUID | None] = fk("api_clients.id", ondelete="CASCADE")
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    prefix: Mapped[str] = mapped_column(String(12), nullable=False, index=True)
    secret_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="ACTIVE", index=True)
    created_by_id: Mapped[UUID | None] = fk("users.id")
    expires_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    last_used_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    revoked_by_id: Mapped[UUID | None] = fk("users.id")
    rotated_from_id: Mapped[UUID | None] = fk("api_credentials.id")

    client = relationship("ApiClient", back_populates="credentials")


class ApiRequestLog(Base):
    """Per-request history behind the usage charts on §25."""

    __tablename__ = "api_request_logs"
    __table_args__ = (Index("ix_apilog_client_time", "api_client_id", "requested_at"),)

    id: Mapped[UUID] = uuid_pk()
    api_client_id: Mapped[UUID | None] = fk("api_clients.id", ondelete="CASCADE")
    requested_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    method: Mapped[str] = mapped_column(String(8), nullable=False)
    path: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    duration_ms: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    bytes_out: Mapped[int] = mapped_column(Integer, default=0)
