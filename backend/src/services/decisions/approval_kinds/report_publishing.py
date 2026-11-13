"""Asking to publish a report."""

from __future__ import annotations

from typing import Any

from src.core import audit
from src.core.errors import ConflictError, NotFoundError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.models.approvals import ApprovalRequest
from src.services.decisions import approvals
from src.services.decisions.approval_kinds.access_requests import CHANGE_DECIDER
from src.services.decisions.approvals import Provider


def _apply_report(session, row: ApprovalRequest, *, approved: bool, principal, comment: str) -> None:
    if not approved:
        return
    from src.models.personal import Report

    report = get_or_404(
        session,
        Report,
        parse_uuid((row.payload or {}).get("report_id"), field="report_id"),
        "The report no longer exists.",
        live=True,
    )
    report.scope = (row.payload or {}).get("scope") or "ORGANIZATION"
    audit.record(session, action="UPDATE", resource_type="report", resource_id=report.id,
                 resource_label=report.name, principal=principal,
                 after={"scope": report.scope}, message=f"published {report.name} through {row.reference}")


def request_publish(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.personal import Report

    report = session.get(Report, parse_uuid(payload.get("report_id"), field="report_id"))
    if report is None or report.deleted_at is not None or report.owner_id != principal.user_id:
        raise NotFoundError("That report does not exist, or is not yours to publish.")
    if report.scope == "ORGANIZATION":
        raise ConflictError("This report is already published to the organisation.")
    existing = approvals.find_pending(session, kind="report", subject_type="report", subject_id=report.id)
    if existing is not None:
        return {**approvals.serialize(existing, principal=principal), "already_pending": True}
    row = approvals.submit(
        session, kind="report", requester_id=principal.user_id, requester_label=principal.full_name,
        title=f"Publish report: {report.name}",
        summary=str(payload.get("reason") or "") or "Share this report with the whole organisation.",
        subject_type="report", subject_id=report.id, subject_label=report.name,
        link=f"/reports?report={report.id}",
        payload={"report_id": str(report.id), "scope": "ORGANIZATION", "from_scope": report.scope},
    )
    return {**approvals.serialize(row, principal=principal), "already_pending": False}


def _describe_report(session, row: ApprovalRequest) -> dict[str, Any]:
    payload = row.payload or {}
    return {"facts": [
        {"label": "Currently", "value": str(payload.get("from_scope") or "PRIVATE").title()},
        {"label": "Becomes", "value": "Organisation-wide"},
    ]}


approvals.register(Provider(kind="report", label="Report publishing", icon="report",
                            decide_permission=CHANGE_DECIDER, sla_hours=72, apply=_apply_report,
                            describe=_describe_report))
