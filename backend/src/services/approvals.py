"""The approvals inbox: one queue for everything that needs a decision.

Three ideas carry the module.

**A request is generic; its meaning is a provider's.** Timesheets, access
requests, held-back record edits and report publishing all land in
`approval_requests` with the same columns. What differs — who may decide, what
approving *does*, how long an answer may take — is a `Provider` registered by
the feature that raises the request. A new kind of decision is a new provider,
not a new inbox.

**Nobody approves their own request.** Holding the deciding permission is not
enough when the request is yours; the inbox shows it under *Mine* instead, and
`decide` refuses it with the reason.

**A decision is a write in the same transaction as its effect.** Approving an
access request adds the membership; approving a change applies the held
values; both commit with the status change and the notification, or none of
them do.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Callable
from uuid import UUID

from sqlalchemy import and_, func, or_, select

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import ForbiddenError, NotFoundError, ValidationError
from src.core.naming import identifier, sequence_of
from src.core.pagination import envelope, parse_page, parse_uuid
from src.models.approvals import ApprovalRequest

REFERENCE_PREFIX = "APR"

STATUSES = ("PENDING", "APPROVED", "REJECTED", "WITHDRAWN")
DECISIONS = {"approve": "APPROVED", "reject": "REJECTED"}

#: How many requests one bulk decision may carry.
MAX_BULK = 100


@dataclass
class Provider:
    """What one kind of approval means.

    `apply` is called inside the deciding transaction with the request and
    whether it was approved; raising from it aborts the decision, so a change
    that can no longer be applied is reported rather than recorded as done.
    """

    kind: str
    label: str
    icon: str
    decide_permission: str
    #: How long an answer may take before the inbox calls it late.
    sla_hours: int = 48
    apply: Callable[..., None] | None = None
    #: Extra facts for the detail drawer.
    describe: Callable[..., dict[str, Any]] | None = None
    #: Whether a comment is required to reject.
    reject_needs_comment: bool = True
    extra: dict[str, Any] = field(default_factory=dict)


_PROVIDERS: dict[str, Provider] = {}
_LOADED = False


def register(provider: Provider) -> Provider:
    """Make a kind of approval known. Idempotent: the last registration wins."""
    _PROVIDERS[provider.kind] = provider
    return provider


def providers() -> dict[str, Provider]:
    """Every registered provider, importing the built-in ones on first use.

    Lazily, because the providers import this module to register themselves —
    and an import cycle at boot is a worse failure than one more function call.
    """
    global _LOADED
    if not _LOADED:
        _LOADED = True
        from src.services import approval_kinds, timekeeping  # noqa: F401
    return _PROVIDERS


def provider_for(kind: str) -> Provider:
    found = providers().get(kind)
    if found is None:
        raise ValidationError(
            f"{kind!r} is not a kind of approval.", details={"available": sorted(providers())}
        )
    return found


# ── Raising one ─────────────────────────────────────────────────────────


def _reference(session) -> str:
    latest = session.scalar(
        select(func.max(ApprovalRequest.reference)).where(
            ApprovalRequest.reference.like(f"{REFERENCE_PREFIX}-%")
        )
    )
    number = sequence_of(latest, prefix=REFERENCE_PREFIX) + 1
    candidate = identifier(REFERENCE_PREFIX, number, width=5)
    while session.scalar(select(ApprovalRequest.id).where(ApprovalRequest.reference == candidate)):
        number += 1
        candidate = identifier(REFERENCE_PREFIX, number, width=5)
    return candidate


def _event(action: str, *, actor_id: Any = None, actor_label: str = "", comment: str = "",
           at=None) -> dict[str, Any]:
    return {
        "at": iso(at or now()),
        "action": action,
        "actor_id": str(actor_id) if actor_id else None,
        "actor_label": actor_label,
        "comment": comment or "",
    }


def deciders(session, permission: str, *, limit: int = 12) -> list[Any]:
    """People who may decide a request needing `permission`, through role or group."""
    from src.models.identity import Group, Role, User, user_groups

    by_role = (
        select(User.id)
        .join(Role, User.role_id == Role.id)
        .where(Role.permissions.any(permission))
    )
    by_group = (
        select(user_groups.c.user_id)
        .join(Group, Group.id == user_groups.c.group_id)
        .where(Group.permissions.any(permission), Group.deleted_at.is_(None))
    )
    return list(
        session.scalars(
            select(User)
            .where(
                or_(User.id.in_(by_role), User.id.in_(by_group)),
                User.deleted_at.is_(None),
                User.status == "ACTIVE",
            )
            .order_by(User.last_login_at.desc().nullslast(), User.full_name)
            .limit(limit)
        ).unique()
    )


def submit(
    session,
    *,
    kind: str,
    requester_id: Any,
    requester_label: str,
    title: str,
    summary: str = "",
    subject_type: str | None = None,
    subject_id: Any = None,
    subject_label: str | None = None,
    link: str | None = None,
    payload: dict[str, Any] | None = None,
    assignee_id: Any = None,
    created_at=None,
    notify: bool = True,
) -> ApprovalRequest:
    """Raise a request, route it, and tell the people who can decide it."""
    provider = provider_for(kind)
    moment = created_at or now()
    row = ApprovalRequest(
        reference=_reference(session),
        kind=kind,
        status="PENDING",
        title=title[:240],
        summary=summary or None,
        requester_id=requester_id,
        assignee_id=assignee_id,
        decide_permission=provider.decide_permission,
        subject_type=subject_type,
        subject_id=str(subject_id) if subject_id else None,
        subject_label=(subject_label or None) and subject_label[:240],
        link=link,
        payload=payload or {},
        due_at=moment + timedelta(hours=provider.sla_hours),
        history=[_event("SUBMITTED", actor_id=requester_id, actor_label=requester_label,
                        comment=summary, at=moment)],
        created_at=moment,
    )
    session.add(row)
    session.flush()

    if notify:
        from src.services import notifications

        targets = (
            [assignee_id]
            if assignee_id
            else [user.id for user in deciders(session, provider.decide_permission)]
        )
        for user_id in targets:
            if str(user_id) == str(requester_id):
                continue
            notifications.publish(
                session,
                user_id=user_id,
                title=f"{requester_label} asks: {row.title}",
                category="APPROVAL",
                severity="INFO",
                body=summary,
                link=f"/approvals?open={row.id}",
                icon="check-circle",
                resource_type="approval",
                resource_id=str(row.id),
                group_key=f"approval:{kind}",
            )
    return row


# ── Reading ─────────────────────────────────────────────────────────────


def can_decide(principal, row: ApprovalRequest) -> bool:
    return (
        row.status == "PENDING"
        and principal.can(row.decide_permission)
        and str(row.requester_id) != str(principal.user_id)
    )


def _person(user) -> dict[str, Any] | None:
    if user is None:
        return None
    return {"id": str(user.id), "name": user.full_name, "avatar_url": user.avatar_url,
            "job_title": user.job_title}


def serialize(row: ApprovalRequest, *, principal, moment=None) -> dict[str, Any]:
    moment = moment or now()
    provider = providers().get(row.kind)
    created = row.created_at or moment
    end = row.decided_at or moment
    age_hours = max(0.0, (end - created).total_seconds() / 3600)
    due_in = (row.due_at - moment).total_seconds() / 3600 if row.due_at else None
    if row.status != "PENDING":
        standing = "decided"
    elif due_in is None:
        standing = "ok"
    elif due_in < 0:
        standing = "overdue"
    elif due_in < (provider.sla_hours if provider else 48) * 0.25:
        standing = "due_soon"
    else:
        standing = "ok"
    return {
        "id": str(row.id),
        "reference": row.reference,
        "kind": row.kind,
        "kind_label": provider.label if provider else row.kind,
        "icon": provider.icon if provider else "check",
        "status": row.status,
        "title": row.title,
        "summary": row.summary or "",
        "requester": _person(row.requester),
        "assignee": _person(row.assignee),
        "decided_by": _person(row.decided_by),
        "subject_type": row.subject_type,
        "subject_id": row.subject_id,
        "subject_label": row.subject_label,
        "link": row.link,
        "created_at": iso(row.created_at),
        "due_at": iso(row.due_at),
        "decided_at": iso(row.decided_at),
        "decision_comment": row.decision_comment or "",
        "age_hours": round(age_hours, 1),
        "due_in_hours": None if due_in is None else round(due_in, 1),
        "standing": standing,
        "can_decide": can_decide(principal, row),
        "can_withdraw": row.status == "PENDING" and str(row.requester_id) == str(principal.user_id),
        "mine": str(row.requester_id) == str(principal.user_id),
    }


def _visible(principal):
    """What one person may see: their own requests, and any they could decide."""
    held = [code for code in {p.decide_permission for p in providers().values()}
            if principal.can(code)]
    clauses = [ApprovalRequest.requester_id == principal.user_id]
    if held:
        clauses.append(ApprovalRequest.decide_permission.in_(held))
    return or_(*clauses)


def _inbox(principal):
    held = [code for code in {p.decide_permission for p in providers().values()}
            if principal.can(code)]
    if not held:
        return ApprovalRequest.id.is_(None)
    return and_(
        ApprovalRequest.status == "PENDING",
        ApprovalRequest.decide_permission.in_(held),
        ApprovalRequest.requester_id != principal.user_id,
    )


def pending_count(session, principal) -> int:
    return int(
        session.scalar(select(func.count()).select_from(ApprovalRequest).where(_inbox(principal)))
        or 0
    )


SCOPES = ("inbox", "mine", "history", "all")
SORTS = {
    "created_at": ApprovalRequest.created_at,
    "due_at": ApprovalRequest.due_at,
    "decided_at": ApprovalRequest.decided_at,
    "reference": ApprovalRequest.reference,
}


def listing(session, args, *, principal) -> dict[str, Any]:
    scope = str(args.get("scope") or "inbox")
    if scope not in SCOPES:
        raise ValidationError(f"{scope!r} is not a view of the inbox.", details={"allowed": SCOPES})
    page = parse_page(args, default_sort="created_at",
                      default_order="asc" if scope == "inbox" else "desc")
    if page.sort not in SORTS:
        raise ValidationError(f"Cannot sort by {page.sort!r}.", details={"allowed": sorted(SORTS)})

    clauses = [_visible(principal)]
    if scope == "inbox":
        clauses.append(_inbox(principal))
    elif scope == "mine":
        clauses.append(ApprovalRequest.requester_id == principal.user_id)
    elif scope == "history":
        clauses.append(ApprovalRequest.status != "PENDING")

    base = list(clauses)
    kinds = [k for k in str(args.get("kind") or "").split(",") if k]
    if kinds:
        clauses.append(ApprovalRequest.kind.in_(kinds))
    if args.get("status"):
        clauses.append(ApprovalRequest.status == str(args.get("status")).upper())
    if args.get("requester_id"):
        clauses.append(ApprovalRequest.requester_id == parse_uuid(args.get("requester_id"),
                                                                  field="requester_id"))
    age = str(args.get("age") or "")
    moment = now()
    if age == "today":
        clauses.append(ApprovalRequest.created_at >= moment - timedelta(hours=24))
    elif age == "week":
        clauses.append(ApprovalRequest.created_at >= moment - timedelta(days=7))
    elif age == "older":
        clauses.append(ApprovalRequest.created_at < moment - timedelta(days=7))
    elif age == "overdue":
        clauses.append(and_(ApprovalRequest.status == "PENDING", ApprovalRequest.due_at < moment))
    elif age:
        raise ValidationError(f"{age!r} is not an age filter.",
                              details={"allowed": ["today", "week", "older", "overdue"]})
    q = str(args.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        clauses.append(or_(ApprovalRequest.title.ilike(like), ApprovalRequest.reference.ilike(like),
                           ApprovalRequest.subject_label.ilike(like)))

    total = session.scalar(select(func.count()).select_from(ApprovalRequest).where(*clauses)) or 0
    column = SORTS[page.sort]
    ordering = column.asc().nullslast() if page.order == "asc" else column.desc().nullslast()
    rows = session.scalars(
        select(ApprovalRequest).where(*clauses).order_by(ordering, ApprovalRequest.reference)
        .offset(page.offset).limit(page.page_size)
    ).unique().all()

    by_kind = {
        kind: int(count)
        for kind, count in session.execute(
            select(ApprovalRequest.kind, func.count()).where(*base).group_by(ApprovalRequest.kind)
        ).all()
    }
    requesters = [
        {"id": str(user_id), "name": name, "count": int(count)}
        for user_id, name, count in session.execute(
            _requester_facet(base)
        ).all()
    ]
    return envelope(
        [serialize(row, principal=principal, moment=moment) for row in rows],
        int(total),
        page,
        scope=scope,
        facets={"kind": by_kind, "requester": requesters},
        kinds=[
            {"kind": p.kind, "label": p.label, "icon": p.icon,
             "can_decide": principal.can(p.decide_permission), "sla_hours": p.sla_hours}
            for p in sorted(providers().values(), key=lambda item: item.label)
        ],
        counts={
            "inbox": pending_count(session, principal),
            "overdue": int(session.scalar(
                select(func.count()).select_from(ApprovalRequest)
                .where(_inbox(principal), ApprovalRequest.due_at < moment)) or 0),
            "mine_pending": int(session.scalar(
                select(func.count()).select_from(ApprovalRequest)
                .where(ApprovalRequest.requester_id == principal.user_id,
                       ApprovalRequest.status == "PENDING")) or 0),
        },
    )


def _requester_facet(base):
    from src.models.identity import User

    return (
        select(User.id, User.full_name, func.count())
        .select_from(ApprovalRequest)
        .join(User, User.id == ApprovalRequest.requester_id)
        .where(*base)
        .group_by(User.id, User.full_name)
        .order_by(func.count().desc())
        .limit(20)
    )


def _load(session, ident: Any) -> ApprovalRequest:
    row = session.get(ApprovalRequest, parse_uuid(ident, field="approval_id"))
    if row is None:
        raise NotFoundError("That request does not exist.")
    return row


def entry(session, ident: Any, *, principal) -> dict[str, Any]:
    row = _load(session, ident)
    if not session.scalar(select(ApprovalRequest.id).where(ApprovalRequest.id == row.id,
                                                            _visible(principal))):
        # Not "forbidden": confirming a reference exists is itself a leak.
        raise NotFoundError("That request does not exist.")
    body = serialize(row, principal=principal)
    provider = providers().get(row.kind)
    body["history"] = list(row.history or [])
    body["payload"] = row.payload or {}
    body["details"] = provider.describe(session, row) if provider and provider.describe else {}
    return body


# ── Deciding ────────────────────────────────────────────────────────────


def _decide_row(session, row: ApprovalRequest, status: str, comment: str, *, principal) -> None:
    if row.status != "PENDING":
        raise ValidationError(
            f"{row.reference} was already {row.status.lower()}.", details={"status": row.status}
        )
    if str(row.requester_id) == str(principal.user_id):
        raise ForbiddenError("Nobody approves their own request.",
                             details={"reason": "own_request"})
    if not principal.can(row.decide_permission):
        principal.require(row.decide_permission)
    provider = provider_for(row.kind)
    if status == "REJECTED" and provider.reject_needs_comment and not comment:
        raise ValidationError("Say why it is rejected — the requester will read it.",
                              details={"field": "comment"})

    if provider.apply is not None:
        provider.apply(session, row, approved=status == "APPROVED", principal=principal,
                       comment=comment)

    moment = now()
    row.status = status
    row.decided_at = moment
    row.decided_by_id = principal.user_id
    row.decision_comment = comment or None
    row.history = [
        *(row.history or []),
        _event(status, actor_id=principal.user_id, actor_label=principal.full_name,
               comment=comment, at=moment),
    ]
    session.flush()

    audit.record(
        session,
        action="APPROVE" if status == "APPROVED" else "REJECT",
        resource_type="approval",
        resource_id=row.id,
        resource_label=f"{row.reference} {row.title}"[:255],
        principal=principal,
        after={"status": status, "comment": comment},
        message=f"{'approved' if status == 'APPROVED' else 'rejected'} {row.reference}",
    )

    if row.requester_id:
        from src.services import notifications

        verb = "approved" if status == "APPROVED" else "rejected"
        notifications.publish(
            session,
            user_id=row.requester_id,
            title=f"{principal.full_name} {verb} {row.title}",
            category="APPROVAL",
            severity="INFO" if status == "APPROVED" else "WARNING",
            body=comment or "",
            link=row.link or f"/approvals?scope=mine&open={row.id}",
            icon="check-circle" if status == "APPROVED" else "x-circle",
            resource_type="approval",
            resource_id=str(row.id),
            actor=principal,
            group_key=f"approval:{row.kind}",
        )


def decide(session, ident: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    decision = str(payload.get("decision") or "").lower()
    if decision not in DECISIONS:
        raise ValidationError("decision must be 'approve' or 'reject'.",
                              details={"allowed": sorted(DECISIONS)})
    comment = str(payload.get("comment") or "").strip()[:2000]
    row = _load(session, ident)
    _decide_row(session, row, DECISIONS[decision], comment, principal=principal)
    return entry(session, row.id, principal=principal)


def decide_many(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Decide several at once. Each succeeds or fails on its own, and says which.

    One savepoint per request: a stale or forbidden item in a batch of thirty
    must not undo the twenty-nine that were fine.
    """
    decision = str(payload.get("decision") or "").lower()
    if decision not in DECISIONS:
        raise ValidationError("decision must be 'approve' or 'reject'.",
                              details={"allowed": sorted(DECISIONS)})
    ids = payload.get("ids") or []
    if not isinstance(ids, list) or not ids:
        raise ValidationError("Choose at least one request.", details={"field": "ids"})
    if len(ids) > MAX_BULK:
        raise ValidationError(f"At most {MAX_BULK} at a time.", details={"field": "ids"})
    comment = str(payload.get("comment") or "").strip()[:2000]

    results = []
    for ident in ids:
        try:
            with session.begin_nested():
                row = _load(session, ident)
                _decide_row(session, row, DECISIONS[decision], comment, principal=principal)
            results.append({"id": str(ident), "ok": True})
        except (ValidationError, ForbiddenError, NotFoundError) as exc:
            results.append({"id": str(ident), "ok": False, "error": exc.message})
    done = sum(1 for item in results if item["ok"])
    return {"decided": done, "failed": len(results) - done, "results": results}


def withdraw(session, ident: Any, *, principal) -> dict[str, Any]:
    row = _load(session, ident)
    if str(row.requester_id) != str(principal.user_id):
        raise NotFoundError("That request does not exist.")
    if row.status != "PENDING":
        raise ValidationError(f"{row.reference} was already {row.status.lower()}.")
    provider = provider_for(row.kind)
    if provider.extra.get("on_withdraw"):
        provider.extra["on_withdraw"](session, row)
    row.status = "WITHDRAWN"
    row.decided_at = now()
    row.history = [*(row.history or []),
                   _event("WITHDRAWN", actor_id=principal.user_id, actor_label=principal.full_name)]
    session.flush()
    return entry(session, row.id, principal=principal)


def find_pending(session, *, kind: str, subject_type: str, subject_id: Any) -> ApprovalRequest | None:
    return session.scalars(
        select(ApprovalRequest).where(
            ApprovalRequest.kind == kind,
            ApprovalRequest.subject_type == subject_type,
            ApprovalRequest.subject_id == str(subject_id),
            ApprovalRequest.status == "PENDING",
        )
    ).first()


def as_uuid(value: Any) -> UUID | None:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None
