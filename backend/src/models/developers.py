"""The developer portal's own table: examples captured from real calls (§31).

The endpoint map says what exists and the handlers say who may call it; what
neither says is what an answer *looks like*. So the portal keeps the latest
successful response per route — captured when somebody presses Send in the
try-it console, or seeded — and infers its schema, which makes the reference
show a real shape instead of a guess.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base, TimestampMixin, fk, uuid_pk


class ApiExample(Base, TimestampMixin):
    """The latest captured request and response for one route and method."""

    __tablename__ = "api_examples"
    __table_args__ = (UniqueConstraint("method", "route", name="uq_api_example_route"),)

    id: Mapped[UUID] = uuid_pk()
    method: Mapped[str] = mapped_column(String(8), nullable=False)
    #: The route as the endpoint map spells it, `/api/tasks/<uuid:task_id>`.
    route: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    status_code: Mapped[int] = mapped_column(Integer, default=200, nullable=False)
    #: The concrete path that was called, query string included.
    path: Mapped[str | None] = mapped_column(String(500))
    request_body: Mapped[Any | None] = mapped_column(JSONB)
    #: Truncated: lists keep their first few items, strings their first chars.
    response_sample: Mapped[Any | None] = mapped_column(JSONB)
    response_schema: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    captured_by_id: Mapped[UUID | None] = fk("users.id")
    captured_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
