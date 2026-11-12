"""Intake forms that turn into records, and what was submitted through them.

A form is a list of fields, each optionally *mapped* onto a writable field of
its target dataset (a ticket's subject, a customer's email). A submission is
kept whether or not it became a record — the conversion can fail on a value
the dataset refuses, and "we lost what somebody sent us" is the one outcome an
intake form exists to prevent.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


class IntakeForm(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "intake_forms"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    #: The public address: `/f/<slug>`.
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    #: The dataset a submission becomes a record of — `ticket`, `customer`, `task`…
    target: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    fields: Mapped[list[Any] | None] = mapped_column(JSONB)
    #: visibility, confirmation, notify, captcha, rate limit, fixed defaults.
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: DRAFT, PUBLISHED or CLOSED.
    status: Mapped[str] = mapped_column(String(16), default="DRAFT", nullable=False, index=True)
    owner_id: Mapped[UUID | None] = fk("users.id")
    submission_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")


class FormSubmission(Base, TimestampMixin):
    __tablename__ = "form_submissions"

    id: Mapped[UUID] = uuid_pk()
    form_id: Mapped[UUID] = fk("intake_forms.id", nullable=False, ondelete="CASCADE")
    reference: Mapped[str] = mapped_column(String(24), nullable=False, unique=True, index=True)
    data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: CONVERTED, FAILED or SPAM.
    status: Mapped[str] = mapped_column(String(16), default="CONVERTED", nullable=False, index=True)
    record_type: Mapped[str | None] = mapped_column(String(32))
    record_id: Mapped[str | None] = mapped_column(String(64))
    record_label: Mapped[str | None] = mapped_column(String(240))
    error: Mapped[str | None] = mapped_column(Text)
    submitter_id: Mapped[UUID | None] = fk("users.id")
    submitter_email: Mapped[str | None] = mapped_column(String(255))
    #: A salted hash of the caller's address — enough to rate-limit, not
    #: enough to identify.
    client_hash: Mapped[str | None] = mapped_column(String(64), index=True)

    form = relationship("IntakeForm", lazy="joined")
