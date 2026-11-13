"""Who may decide, the inbox and its badge, and a request as the API returns it."""

from __future__ import annotations

from typing import Any

from sqlalchemy import and_, func, or_, select

from src.core.auth import maybe_me
from src.core.clock import iso, now
from src.models.approvals import ApprovalRequest
from src.services.collaboration import notifications
from src.services.decisions.approvals.registry import providers


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


@notifications.badges.connect
def _pending_badge(session, user_id) -> dict[str, int]:
    """The approvals inbox badge on the notification poll."""
    principal = maybe_me()
    return {"pending_approvals": pending_count(session, principal) if principal is not None else 0}


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
