"""Submitting a request for approval."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from src.core.clock import now
from src.models.approvals import ApprovalRequest
from src.services.collaboration import notifications
from src.services.decisions.approvals.registry import (
    _event,
    _reference,
    deciders,
    provider_for,
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
