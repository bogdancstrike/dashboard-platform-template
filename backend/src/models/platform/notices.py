"""Notifications and announcements with their read receipts."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import (
    Base,
    MetadataMixin,
    SoftDeleteMixin,
    TimestampMixin,
    fk,
    uuid_pk,
)


class Notification(Base, TimestampMixin):
    """In-app notifications (§17)."""

    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notification_user_read", "user_id", "is_read"),)

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    category: Mapped[str] = mapped_column(String(24), default="INFO", index=True)
    severity: Mapped[str] = mapped_column(String(16), default="INFO", index=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(48))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    read_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    #: Where clicking it goes. A notification you cannot act on is noise (§66).
    link: Mapped[str | None] = mapped_column(String(500))
    resource_type: Mapped[str | None] = mapped_column(String(48), index=True)
    resource_id: Mapped[str | None] = mapped_column(String(64))
    actor_id: Mapped[UUID | None] = fk("users.id")
    actor_label: Mapped[str | None] = mapped_column(String(160))
    group_key: Mapped[str | None] = mapped_column(String(96), index=True)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class Announcement(Base, TimestampMixin, SoftDeleteMixin, MetadataMixin):
    """A message from the platform to the people using it (§17, §34).

    Deliberately not a `Notification`. A notification is *one person's* — it is
    addressed, it is read once, and it disappears. An announcement is a
    *notice*: it is written once for many readers, it has a window during which
    it is true, and whether a given person has seen it is a fact about that
    person rather than about the notice. Modelling one as the other would mean
    either writing a row per reader at publish time — which cannot be edited
    afterwards without touching thousands of rows — or losing per-reader state
    entirely, which is the thing a maintenance notice most needs.

    So: the notice here, the reader's side of it in `AnnouncementReceipt`.

    The audience is expressed as *what a reader is*, never as a list of people:
    an empty `audience_roles` means everyone, and an `organization_id` scopes it
    to one tenant. A notice addressed by enumerating recipients is a notice
    that silently misses whoever joined after it was written.
    """

    __tablename__ = "announcements"
    __table_args__ = (
        # The one query this table exists to answer: what is live now.
        Index("ix_announcement_live", "status", "publish_at", "expires_at"),
    )

    id: Mapped[UUID] = uuid_pk()
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    #: What sort of notice it is: RELEASE, MAINTENANCE, INCIDENT, POLICY, NEWS.
    category: Mapped[str] = mapped_column(String(24), default="NEWS", index=True)
    #: How loudly to say it: INFO, WARNING, CRITICAL — the same three words
    #: notifications use, so one reader learns one vocabulary.
    severity: Mapped[str] = mapped_column(String(16), default="INFO", index=True)
    #: DRAFT → SCHEDULED → PUBLISHED → ARCHIVED. `EXPIRED` is *derived* from
    #: `expires_at` rather than stored: a status that has to be swept by a job
    #: is a status that is wrong between sweeps.
    status: Mapped[str] = mapped_column(String(16), default="DRAFT", index=True)
    publish_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    expires_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    #: Empty means every role. Roles rather than users — see the class docstring.
    audience_roles: Mapped[list[str] | None] = mapped_column(ARRAY(String(48)))
    #: `None` means every organization.
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    #: A notice that asks for a response rather than merely being readable.
    requires_acknowledgement: Mapped[bool] = mapped_column(Boolean, default=False)
    #: Held at the top of the list while it is live, for the one that matters.
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    #: Where to go to act on it. A notice you cannot act on is noise (§66).
    link: Mapped[str | None] = mapped_column(String(500))
    author_id: Mapped[UUID | None] = fk("users.id")
    author_label: Mapped[str | None] = mapped_column(String(160))

    receipts = relationship(
        "AnnouncementReceipt",
        back_populates="announcement",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class AnnouncementReceipt(Base, TimestampMixin):
    """One reader's side of one notice (§17).

    Written when somebody reads or acknowledges, never at publish time: a
    receipt per reader created up front is a table that grows with
    (notices × people) whether or not anybody looked, and it makes editing a
    published notice a write to every one of those rows.

    Reading and acknowledging are two columns rather than one status, because
    they are two different facts and a maintenance notice needs both: "everyone
    has seen it" and "eleven people have agreed to it" are different questions.
    """

    __tablename__ = "announcement_receipts"
    __table_args__ = (
        Index(
            "ux_announcement_receipt",
            "announcement_id",
            "user_id",
            unique=True,
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    announcement_id: Mapped[UUID] = fk("announcements.id", ondelete="CASCADE", nullable=False)
    user_id: Mapped[UUID] = fk("users.id", ondelete="CASCADE", nullable=False)
    read_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    acknowledged_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))

    announcement = relationship("Announcement", back_populates="receipts")
