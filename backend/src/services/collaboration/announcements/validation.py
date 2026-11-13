"""An announcement's payload, checked."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select

from src.core.cleaners import choice, flag, not_a, text
from src.core.clock import iso
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.core.validation import Field, Schema
from src.services.collaboration.announcements.vocabulary import (
    SEVERITIES,
    STATUSES,
    _category,
    _one_of,
)


def _row(session, announcement_id: Any):
    from src.models.platform import Announcement

    identifier = parse_uuid(announcement_id, field="announcement_id")
    row = session.scalars(
        select(Announcement).where(
            Announcement.id == identifier, Announcement.deleted_at.is_(None)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError(
            "That announcement does not exist.", details={"id": str(identifier)}
        )
    return row


def _organization(raw: Any, ctx) -> UUID | None:
    """An author may narrow a notice to their own tenant or leave it open to
    every one; they may not address somebody else's."""
    if raw in (None, ""):
        return None
    identifier = parse_uuid(raw, field="organization_id")
    if ctx.principal.organization_id and identifier != ctx.principal.organization_id:
        raise ValidationError(
            "An announcement can be addressed to your own organization or to all.",
            details={"organization_id": str(identifier)},
        )
    return identifier


def _window_opens_before_it_closes(out: dict[str, Any], ctx) -> None:
    """A window that closes before it opens is a notice nobody will ever see,
    and it fails silently: the list simply never matches it."""
    opens, closes = out.get("publish_at"), out.get("expires_at")
    if opens and closes and closes <= opens:
        raise ValidationError(
            "An announcement cannot expire before it is published.",
            details={"publish_at": iso(opens), "expires_at": iso(closes)},
        )


_SCHEMA = Schema(
    [
        Field("title", text(240, required="An announcement needs a title.")),
        Field("body", text()),
        Field("category", lambda raw, ctx: _category(raw) or "NEWS"),
        Field("severity", choice(SEVERITIES, default="INFO", strip=True, error=not_a("severity"))),
        Field("status", choice(STATUSES, default="DRAFT", strip=True, error=not_a("status"))),
        Field("publish_at", lambda raw, ctx: _moment(raw, "publish_at")),
        Field("expires_at", lambda raw, ctx: _moment(raw, "expires_at")),
        Field("audience_roles", lambda raw, ctx: _roles(raw)),
        Field("requires_acknowledgement", flag),
        Field("is_pinned", flag),
        Field("link", text(500, empty=None)),
        Field("organization_id", _organization),
    ],
    not_object="The announcement must be a JSON object.",
    unknown="Unknown fields.",
    unknown_lists_allowed=True,
    checks=[_window_opens_before_it_closes],
)


def _validated(payload: Any, *, principal, partial: bool) -> dict[str, Any]:
    return _SCHEMA.validate(payload, principal=principal, partial=partial)


def _status(raw: Any) -> str:
    value = str(raw or "").strip().upper()
    return _one_of(value, STATUSES, "status") if value else ""


def _roles(raw: Any) -> list[str]:
    """The role codes a notice is addressed to, or an empty list for everybody.

    Validated against the role catalogue: a notice addressed to `MANAGERS`
    (which is not a role code — `MANAGER` is) reaches nobody, and does it
    silently.
    """
    if raw in (None, ""):
        return []
    if not isinstance(raw, list):
        raise ValidationError("audience_roles must be an array of role codes.")

    from src.core.auth import ROLE_DEFAULTS

    codes = [str(item).strip().upper() for item in raw if str(item).strip()]
    unknown = sorted({code for code in codes if code not in ROLE_DEFAULTS})
    if unknown:
        raise ValidationError(
            "Those are not role codes.",
            details={"roles": unknown, "allowed": sorted(ROLE_DEFAULTS)},
        )
    return sorted(set(codes))


def _moment(raw: Any, field: str):
    if raw in (None, ""):
        return None
    from datetime import datetime

    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError(f"{field} must be an ISO 8601 instant.", details={field: str(raw)}) from exc
    if parsed.tzinfo is None:
        from datetime import timezone

        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed
