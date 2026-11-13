"""Announcement categories, severities and statuses; audience, read receipts and one notice as the API returns it."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select

from src.core.clock import iso
from src.core.errors import ValidationError
from src.core.naming import initials

#: Reading needs nothing: a notice is addressed to everybody by definition.
#: Writing one is a broadcast, and that is the privilege.
MANAGE_PERMISSION = "announcements.manage"


#: What sort of notice it is. Not free text: the reader's filter strip is built
#: from this, and a category somebody typed once is a chip that appears for one
#: notice and confuses everybody who sees it.
CATEGORIES: tuple[tuple[str, str], ...] = (
    ("RELEASE", "Releases"),
    ("MAINTENANCE", "Maintenance"),
    ("INCIDENT", "Incidents"),
    ("POLICY", "Policy"),
    ("NEWS", "News"),
)


#: How loudly. The same three words notifications use, so a reader learns one
#: vocabulary rather than one per page.
SEVERITIES: tuple[str, ...] = ("INFO", "WARNING", "CRITICAL")


#: The lifecycle. `EXPIRED` is deliberately absent — see the module docstring.
STATUSES: tuple[str, ...] = ("DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED")


CATEGORY_LABELS = dict(CATEGORIES)


def _live_clause(model, moment):
    """The one condition this table exists to answer: is it live *now*."""
    return (
        (model.status == "PUBLISHED")
        & (or_(model.publish_at.is_(None), model.publish_at <= moment))
        & (or_(model.expires_at.is_(None), model.expires_at > moment))
    )


def _audience_clause(model, principal):
    """Whether a notice is addressed to this reader.

    Two independent narrowings, both open by default: an empty
    `audience_roles` is everybody, and a null `organization_id` is every
    tenant. Written as SQL rather than filtered in Python because "what should
    I be shown" must be a `WHERE` clause — a page that downloads every notice
    and hides most of them has published them all to anybody with a debugger.
    """
    role = getattr(principal, "role_code", None) or ""
    audience = or_(
        model.audience_roles.is_(None),
        func.cardinality(model.audience_roles) == 0,
        model.audience_roles.any(role),
    )
    scope = or_(
        model.organization_id.is_(None),
        model.organization_id == principal.organization_id,
    )
    return audience & scope


def _unread_count(session, principal, moment) -> int:
    from src.models.platform import Announcement, AnnouncementReceipt

    seen = (
        select(AnnouncementReceipt.id)
        .where(
            AnnouncementReceipt.announcement_id == Announcement.id,
            AnnouncementReceipt.user_id == principal.user_id,
            AnnouncementReceipt.read_at.is_not(None),
        )
        .exists()
    )
    return int(
        session.scalar(
            select(func.count())
            .select_from(Announcement)
            .where(
                Announcement.deleted_at.is_(None),
                _audience_clause(Announcement, principal),
                _live_clause(Announcement, moment),
                ~seen,
            )
        )
        or 0
    )


def _receipts_for(session, ids: list[UUID], principal) -> dict[UUID, Any]:
    if not ids:
        return {}
    from src.models.platform import AnnouncementReceipt

    rows = session.scalars(
        select(AnnouncementReceipt).where(
            AnnouncementReceipt.announcement_id.in_(ids),
            AnnouncementReceipt.user_id == principal.user_id,
        )
    ).all()
    return {row.announcement_id: row for row in rows}


def _notice(row, receipt, *, moment, reach: dict[str, int] | None = None) -> dict[str, Any]:
    expired = bool(row.expires_at and row.expires_at <= moment)
    scheduled = bool(row.publish_at and row.publish_at > moment)
    body: dict[str, Any] = {
        "id": str(row.id),
        "title": row.title,
        "body": row.body or "",
        "category": row.category,
        "category_label": CATEGORY_LABELS.get(row.category, row.category),
        "severity": row.severity,
        "status": row.status,
        # Derived, not stored: a status swept by a job is wrong between sweeps.
        "is_live": row.status == "PUBLISHED" and not expired and not scheduled,
        "is_expired": expired,
        "is_scheduled": scheduled,
        "is_pinned": bool(row.is_pinned),
        "publish_at": iso(row.publish_at) if row.publish_at else None,
        "expires_at": iso(row.expires_at) if row.expires_at else None,
        "audience_roles": list(row.audience_roles or []),
        "requires_acknowledgement": bool(row.requires_acknowledgement),
        "link": row.link,
        "author": {
            "id": str(row.author_id) if row.author_id else None,
            "name": row.author_label,
            "initials": initials(row.author_label) if row.author_label else None,
        },
        "created_at": iso(row.created_at) if row.created_at else None,
        "updated_at": iso(row.updated_at) if row.updated_at else None,
        # This reader's side of it.
        "read_at": iso(receipt.read_at) if receipt and receipt.read_at else None,
        "acknowledged_at": (
            iso(receipt.acknowledged_at) if receipt and receipt.acknowledged_at else None
        ),
    }
    if reach is not None:
        body["reach"] = reach
    return body


def _category(raw: Any) -> str:
    value = str(raw or "").strip().upper()
    if not value:
        return ""
    return _one_of(value, tuple(key for key, _ in CATEGORIES), "category")


def _one_of(raw: Any, allowed: tuple[str, ...], field: str) -> str:
    value = str(raw or "").strip().upper()
    if value not in allowed:
        raise ValidationError(
            f"That is not a {field}.", details={field: value, "allowed": list(allowed)},
        )
    return value
