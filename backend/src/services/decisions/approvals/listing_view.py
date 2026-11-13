"""The approvals list and one request."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import and_, func, or_, select

from src.core.clock import now
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.repository import get_or_404
from src.models.approvals import ApprovalRequest
from src.services.decisions.approvals.inbox import (
    SCOPES,
    SORTS,
    _inbox,
    _visible,
    pending_count,
    serialize,
)
from src.services.decisions.approvals.registry import providers


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
    row = get_or_404(
        session,
        ApprovalRequest,
        parse_uuid(ident, field="approval_id"),
        "That request does not exist.",
    )
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
