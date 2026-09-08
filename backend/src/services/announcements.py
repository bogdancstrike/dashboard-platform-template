"""Announcements — the platform talking to the people using it (§17, §34).

**Why this is not a notification.** A notification is *one person's*: it is
addressed, read once and gone. An announcement is a *notice* — written once
for many readers, true for a window of time, and whether a given person has
seen it is a fact about that person rather than about the notice. See
`models/platform.Announcement` for what that costs either way round.

Three decisions shape this module.

**"Live" is computed, never stored.** A notice is live when its status is
`PUBLISHED`, its `publish_at` has passed and its `expires_at` has not. A
`status` column swept to `EXPIRED` by a job is a column that is wrong between
sweeps, and the sweep is exactly the thing nobody notices has stopped. So
`expired` is derived on read and the window is a `WHERE` clause.

**The audience is what a reader *is*, never a list of who they are.** An empty
`audience_roles` means everybody; a role code means anybody holding it; an
`organization_id` scopes it to one tenant. A notice addressed by enumerating
recipients silently misses whoever joined after it was written — which for a
maintenance window is the population that most needs it.

**Reading and acknowledging are separate facts.** "Everybody has seen it" and
"eleven people have agreed to it" are different questions, and a notice that
asks for a response has to be able to answer the second. Receipts are written
on the reader's action, not at publish time: a row per reader created up front
grows with (notices × people) whether or not anybody looked, and turns editing
a published notice into a write to thousands of rows.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select

from src.core.clock import iso, now
from src.core.errors import NotFoundError, ValidationError
from src.core.naming import initials
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import count_of

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


def feed(session, args, *, principal) -> dict[str, Any]:
    """The notices this reader should see, newest and most urgent first.

    Includes what has expired only when asked for: a maintenance window that
    has passed is history, and history is worth being able to look up without
    being shown it every morning.
    """
    from src.models.platform import Announcement, AnnouncementReceipt

    page = parse_page(args, default_sort="publish_at")
    moment = now()
    category = _category(args.get("category"))
    include_expired = str(args.get("include_expired") or "").lower() in ("1", "true", "yes")
    unread_only = str(args.get("unread") or "").lower() in ("1", "true", "yes")

    statement = select(Announcement).where(
        Announcement.deleted_at.is_(None),
        _audience_clause(Announcement, principal),
    )
    if include_expired:
        # Everything that was ever published to this reader, live or not —
        # never drafts, which are their author's business.
        statement = statement.where(
            Announcement.status.in_(("PUBLISHED", "ARCHIVED")),
            or_(Announcement.publish_at.is_(None), Announcement.publish_at <= moment),
        )
    else:
        statement = statement.where(_live_clause(Announcement, moment))
    if category:
        statement = statement.where(Announcement.category == category)

    if unread_only:
        # A correlated NOT EXISTS rather than a join: a reader with no receipts
        # at all must see everything, which an inner join would hide.
        seen = (
            select(AnnouncementReceipt.id)
            .where(
                AnnouncementReceipt.announcement_id == Announcement.id,
                AnnouncementReceipt.user_id == principal.user_id,
                AnnouncementReceipt.read_at.is_not(None),
            )
            .exists()
        )
        statement = statement.where(~seen)

    ordered = statement.order_by(
        # Pinned first, then the newest. The pin is what an operator has said
        # matters more than recency, and recency is the tiebreak.
        Announcement.is_pinned.desc(),
        Announcement.publish_at.desc().nullslast(),
        Announcement.created_at.desc(),
    )
    total = count_of(session, ordered)
    rows = session.scalars(ordered.offset(page.offset).limit(page.page_size)).all()

    receipts = _receipts_for(session, [row.id for row in rows], principal)

    return envelope(
        [_notice(row, receipts.get(row.id), moment=moment) for row in rows],
        total,
        page,
        categories=[
            {"key": key, "label": label, "count": count}
            for key, label, count in _category_counts(session, principal, moment)
        ],
        unread=_unread_count(session, principal, moment),
        can_manage=principal.can(MANAGE_PERMISSION),
        category=category,
        include_expired=include_expired,
    )


def _category_counts(session, principal, moment):
    """A count per category over what is live for this reader.

    The server's, over the whole match — a strip counting the page it returned
    would say "of the twenty I sent" (§71). Every declared category is
    returned, at zero when there is nothing: a chip that vanishes teaches a
    reader that the platform has stopped publishing releases.
    """
    from src.models.platform import Announcement

    counted = dict(
        session.execute(
            select(Announcement.category, func.count())
            .where(
                Announcement.deleted_at.is_(None),
                _audience_clause(Announcement, principal),
                _live_clause(Announcement, moment),
            )
            .group_by(Announcement.category)
        ).all()
    )
    return [(key, label, int(counted.get(key, 0))) for key, label in CATEGORIES]


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


def drafts(session, args, *, principal) -> dict[str, Any]:
    """Every notice, whatever its state — the author's view.

    A separate function rather than a flag on `feed`, because it is a different
    question with a different permission: `feed` answers "what am I being
    told", this answers "what have we written". A single endpoint doing both
    would be one `if` away from publishing somebody's draft.
    """
    principal.require(MANAGE_PERMISSION)
    from src.models.platform import Announcement

    page = parse_page(args, default_sort="created_at")
    moment = now()
    status = _status(args.get("status"))

    statement = select(Announcement).where(Announcement.deleted_at.is_(None))
    if principal.organization_id:
        statement = statement.where(
            or_(
                Announcement.organization_id.is_(None),
                Announcement.organization_id == principal.organization_id,
            )
        )
    if status:
        statement = statement.where(Announcement.status == status)

    ordered = statement.order_by(Announcement.created_at.desc())
    total = count_of(session, ordered)
    rows = session.scalars(ordered.offset(page.offset).limit(page.page_size)).all()
    reach = _reach_for(session, [row.id for row in rows])

    return envelope(
        # Zeros rather than a missing key for a notice nobody has read: two
        # shapes for one field is two code paths in every client that reads it.
        [
            _notice(row, None, moment=moment, reach=reach.get(row.id, _NO_REACH))
            for row in rows
        ],
        total,
        page,
        statuses=list(STATUSES),
        status=status,
        can_manage=True,
    )


#: What a notice nobody has read reached. A constant so every path returns the
#: same shape rather than sometimes omitting the field.
_NO_REACH: dict[str, int] = {"read": 0, "acknowledged": 0}


def _reach_for(session, ids: list[UUID]) -> dict[UUID, dict[str, int]]:
    """How many people have read and acknowledged each notice.

    One grouped query for the page rather than one per row: a list of twenty
    notices that issues forty counts is a list that gets slower with every
    notice ever written (§71).
    """
    if not ids:
        return {}
    from src.models.platform import AnnouncementReceipt

    rows = session.execute(
        select(
            AnnouncementReceipt.announcement_id,
            func.count(AnnouncementReceipt.read_at),
            func.count(AnnouncementReceipt.acknowledged_at),
        )
        .where(AnnouncementReceipt.announcement_id.in_(ids))
        .group_by(AnnouncementReceipt.announcement_id)
    ).all()
    return {row[0]: {"read": int(row[1]), "acknowledged": int(row[2])} for row in rows}


def get(session, announcement_id: Any, *, principal) -> dict[str, Any]:
    """One notice, with this reader's receipt on it."""
    row = _row(session, announcement_id)
    moment = now()
    if not principal.can(MANAGE_PERMISSION) and not _visible_to(row, principal, moment):
        # 404 rather than 403: telling somebody a notice exists but is not for
        # them is itself a disclosure about who is being told what.
        raise NotFoundError("That announcement does not exist.", details={"id": str(row.id)})

    receipts = _receipts_for(session, [row.id], principal)
    reach = (
        _reach_for(session, [row.id]).get(row.id, _NO_REACH)
        if principal.can(MANAGE_PERMISSION)
        else None
    )
    return _notice(row, receipts.get(row.id), moment=moment, reach=reach)


def create(session, payload: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    from src.core import audit
    from src.models.platform import Announcement

    values = _validated(payload, principal=principal, partial=False)
    row = Announcement(
        **values,
        author_id=principal.user_id,
        author_label=principal.full_name,
    )
    session.add(row)
    session.flush()
    audit.record(
        session, action="CREATE", resource_type="announcement", resource_id=row.id,
        resource_label=row.title, principal=principal, after=_state(row),
    )
    return _notice(row, None, moment=now(), reach={"read": 0, "acknowledged": 0})


def update(session, announcement_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    from src.core import audit
    from src.models.platform import Announcement

    row = _row(session, announcement_id)
    values = _validated(payload, principal=principal, partial=True)
    before = _state(row)
    for key, value in values.items():
        setattr(row, key, value)
    session.flush()
    audit.record(
        session, action="UPDATE", resource_type="announcement", resource_id=row.id,
        resource_label=row.title, principal=principal, before=before, after=_state(row),
    )
    return _notice(
        row, None, moment=now(), reach=_reach_for(session, [row.id]).get(row.id, _NO_REACH)
    )


def remove(session, announcement_id: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    from src.core import audit

    row = _row(session, announcement_id)
    # Soft, like every other record: a notice that was published and then
    # deleted is something people remember receiving, and the audit trail has
    # to be able to point at it.
    row.deleted_at = now()
    session.flush()
    audit.record(
        session, action="DELETE", resource_type="announcement", resource_id=row.id,
        resource_label=row.title, principal=principal,
    )
    return {"id": str(row.id), "title": row.title, "deleted": True}


def mark(session, announcement_id: Any, payload: Any, *, principal) -> dict[str, Any]:
    """Record that this reader has read — or acknowledged — this notice.

    Upserted on the reader's action rather than written at publish time, and
    idempotent: a page that marks on render will send this more than once, and
    the second one must not move the timestamp the first one recorded.
    """
    from src.models.platform import AnnouncementReceipt

    row = _row(session, announcement_id)
    moment = now()
    if not _visible_to(row, principal, moment):
        raise NotFoundError("That announcement does not exist.", details={"id": str(row.id)})

    body = payload if isinstance(payload, dict) else {}
    acknowledge = bool(body.get("acknowledged"))
    if acknowledge and not row.requires_acknowledgement:
        raise ValidationError(
            "That announcement does not ask to be acknowledged.",
            details={"id": str(row.id)},
        )

    receipt = session.scalars(
        select(AnnouncementReceipt).where(
            AnnouncementReceipt.announcement_id == row.id,
            AnnouncementReceipt.user_id == principal.user_id,
        )
    ).one_or_none()
    if receipt is None:
        receipt = AnnouncementReceipt(announcement_id=row.id, user_id=principal.user_id)
        session.add(receipt)

    receipt.read_at = receipt.read_at or moment
    if acknowledge:
        receipt.acknowledged_at = receipt.acknowledged_at or moment
    session.flush()

    return _notice(row, receipt, moment=moment)


# ── serialisation ────────────────────────────────────────────────────────


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


def _state(row) -> dict[str, Any]:
    """What the audit trail records about a notice.

    A projection rather than the validated payload: the payload holds
    `datetime` and `UUID` objects, and the whole state goes into a JSONB
    column. `core/audit.jsonable` now coerces those centrally — this stays a
    projection because the *diff* should read as the decisions somebody made,
    not as every column of the row.
    """
    return {
        "title": row.title,
        "category": row.category,
        "severity": row.severity,
        "status": row.status,
        "publish_at": iso(row.publish_at) if row.publish_at else None,
        "expires_at": iso(row.expires_at) if row.expires_at else None,
        "audience_roles": list(row.audience_roles or []),
        "requires_acknowledgement": bool(row.requires_acknowledgement),
        "is_pinned": bool(row.is_pinned),
    }


def _visible_to(row, principal, moment) -> bool:
    """Whether this notice is addressed to this reader, and live.

    The same rule the list applies, in Python, for the single-row paths. Two
    expressions of one rule is a risk, so the list's is the SQL translation of
    this and the tests assert they agree on a notice for another role.
    """
    if row.deleted_at is not None:
        return False
    if row.status != "PUBLISHED":
        return False
    if row.publish_at and row.publish_at > moment:
        return False
    if row.expires_at and row.expires_at <= moment:
        return False
    roles = list(row.audience_roles or [])
    if roles and (getattr(principal, "role_code", None) or "") not in roles:
        return False
    return row.organization_id in (None, principal.organization_id)


# ── validation ───────────────────────────────────────────────────────────


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


def _validated(payload: Any, *, principal, partial: bool) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("The announcement must be a JSON object.")

    allowed = {
        "title", "body", "category", "severity", "status", "publish_at", "expires_at",
        "audience_roles", "requires_acknowledgement", "is_pinned", "link",
        "organization_id",
    }
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise ValidationError(
            "Unknown fields.", details={"fields": unknown, "allowed": sorted(allowed)},
        )

    out: dict[str, Any] = {}

    if not partial or "title" in payload:
        title = str(payload.get("title") or "").strip()
        if not title:
            raise ValidationError("An announcement needs a title.")
        out["title"] = title[:240]
    if not partial or "body" in payload:
        out["body"] = str(payload.get("body") or "").strip()
    if not partial or "category" in payload:
        out["category"] = _category(payload.get("category")) or "NEWS"
    if not partial or "severity" in payload:
        out["severity"] = _one_of(payload.get("severity") or "INFO", SEVERITIES, "severity")
    if not partial or "status" in payload:
        out["status"] = _one_of(payload.get("status") or "DRAFT", STATUSES, "status")
    for field in ("publish_at", "expires_at"):
        if not partial or field in payload:
            out[field] = _moment(payload.get(field), field)
    if not partial or "audience_roles" in payload:
        out["audience_roles"] = _roles(payload.get("audience_roles"))
    if not partial or "requires_acknowledgement" in payload:
        out["requires_acknowledgement"] = bool(payload.get("requires_acknowledgement"))
    if not partial or "is_pinned" in payload:
        out["is_pinned"] = bool(payload.get("is_pinned"))
    if not partial or "link" in payload:
        link = str(payload.get("link") or "").strip()
        out["link"] = link[:500] or None
    if not partial or "organization_id" in payload:
        raw = payload.get("organization_id")
        # An author may narrow a notice to their own tenant or leave it open to
        # every one; they may not address somebody else's.
        if raw in (None, ""):
            out["organization_id"] = None
        else:
            identifier = parse_uuid(raw, field="organization_id")
            if principal.organization_id and identifier != principal.organization_id:
                raise ValidationError(
                    "An announcement can be addressed to your own organization or to all.",
                    details={"organization_id": str(identifier)},
                )
            out["organization_id"] = identifier

    # A window that closes before it opens is a notice nobody will ever see,
    # and it fails silently: the list simply never matches it.
    opens = out.get("publish_at")
    closes = out.get("expires_at")
    if opens and closes and closes <= opens:
        raise ValidationError(
            "An announcement cannot expire before it is published.",
            details={"publish_at": iso(opens), "expires_at": iso(closes)},
        )
    return out


def _category(raw: Any) -> str:
    value = str(raw or "").strip().upper()
    if not value:
        return ""
    return _one_of(value, tuple(key for key, _ in CATEGORIES), "category")


def _status(raw: Any) -> str:
    value = str(raw or "").strip().upper()
    return _one_of(value, STATUSES, "status") if value else ""


def _one_of(raw: Any, allowed: tuple[str, ...], field: str) -> str:
    value = str(raw or "").strip().upper()
    if value not in allowed:
        raise ValidationError(
            f"That is not a {field}.", details={field: value, "allowed": list(allowed)},
        )
    return value


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
