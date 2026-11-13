"""Deciding one or many, and withdrawing."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select

from src.core import audit
from src.core.clock import now
from src.core.errors import ForbiddenError, NotFoundError, ValidationError
from src.models.approvals import ApprovalRequest
from src.services.collaboration import notifications
from src.services.decisions.approvals.listing_view import _load, entry
from src.services.decisions.approvals.registry import (
    DECISIONS,
    MAX_BULK,
    _event,
    provider_for,
)


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
