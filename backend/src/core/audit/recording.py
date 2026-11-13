"""Writing an audit row."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from src.core.audit.redaction import diff, redact
from src.core.clock import now


def record(
    session,
    *,
    action: str,
    resource_type: str,
    resource_id: Any = None,
    resource_label: str = "",
    principal=None,
    result: str = "SUCCESS",
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    message: str = "",
    activity: bool = True,
    project_id: UUID | None = None,
):
    """Append one audit row (and, unless suppressed, one activity entry).

    Deliberately takes the caller's `session` rather than opening its own: the
    audit row must commit in the same transaction as the change it describes,
    or a rolled-back update leaves an audit entry claiming it happened.
    """
    from flask import has_request_context

    from src.core.auth import session_fingerprint
    from src.core.correlation import correlation_id
    from src.models.platform import ActivityEntry, AuditLog

    fingerprint = {"ip_address": "system", "user_agent": "", "device": "Server"}
    correlation = ""
    if has_request_context():
        try:
            fingerprint = session_fingerprint()
            correlation = correlation_id()
        except Exception:
            pass

    changes = diff(before, after)
    entry = AuditLog(
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id else None,
        resource_label=resource_label[:255] if resource_label else "",
        actor_id=principal.user_id if principal else None,
        actor_label=(principal.full_name if principal else "System")[:160],
        actor_role=principal.role_code if principal else "SYSTEM",
        organization_id=principal.organization_id if principal else None,
        result=result,
        ip_address=fingerprint["ip_address"],
        user_agent=fingerprint["user_agent"],
        correlation_id=correlation,
        message=message[:500] if message else "",
        state_before=redact(before) or None,
        state_after=redact(after) or None,
        changed_fields=list(changes) or None,
        changes=changes or None,
        metadata_json=metadata or None,
        occurred_at=now(),
        impersonated=bool(principal and principal.is_impersonating),
        # Who was actually at the keyboard. `actor_*` above is who the request
        # was treated as, and during an impersonation those are two different
        # people — which is the first thing anybody asks of such a row.
        impersonator_id=principal.impersonator_id if principal else None,
        impersonator_label=(principal.impersonator_label if principal else "")[:160] or None,
    )
    session.add(entry)

    # Every audited write says which dataset it changed, and `core/db` bumps
    # that dataset's cache generation *after the commit*. One choke point
    # rather than a call in each service: this function already runs for every
    # change the product records, so a new endpoint gets correct invalidation
    # the day it starts auditing — which it must do anyway.
    from src.core.db import touched

    touched(session, resource_type, "activity" if activity else "")

    if activity:
        session.add(
            ActivityEntry(
                kind=_activity_kind(action),
                action=action,
                actor_id=principal.user_id if principal else None,
                actor_label=(principal.full_name if principal else "System")[:160],
                resource_type=resource_type,
                resource_id=str(resource_id) if resource_id else None,
                resource_label=resource_label[:255] if resource_label else "",
                project_id=project_id,
                organization_id=principal.organization_id if principal else None,
                summary=message[:500] or _summarise(action, resource_type, resource_label),
                metadata_json={"changed": list(changes)} if changes else None,
                occurred_at=now(),
            )
        )
    return entry


def _activity_kind(action: str) -> str:
    if action in ("COMMENT",):
        return "COMMENT"
    if action in ("UPLOAD", "DOWNLOAD"):
        return "FILE"
    if action in ("PERMISSION_CHANGE", "CONFIGURATION_CHANGE"):
        return "SYSTEM"
    if action in ("STATUS_CHANGE",):
        return "STATUS"
    if action in ("LOGIN", "LOGOUT", "LOGIN_FAILED", "IMPERSONATE", "SESSION_REVOKE"):
        return "SECURITY"
    if action in ("ASSIGN",):
        return "ASSIGNMENT"
    return "UPDATE" if action == "UPDATE" else "SYSTEM" if action.startswith("JOB") else "RECORD"


def _summarise(action: str, resource_type: str, label: str) -> str:
    verb = {
        "CREATE": "created", "UPDATE": "updated", "DELETE": "deleted",
        "EXPORT": "exported", "IMPORT": "imported", "ASSIGN": "assigned",
        "STATUS_CHANGE": "changed the status of", "COMMENT": "commented on",
        "PERMISSION_CHANGE": "changed permissions on",
        "CONFIGURATION_CHANGE": "reconfigured",
    }.get(action, action.replace("_", " ").lower())
    subject = label or resource_type.replace("_", " ")
    return f"{verb} {resource_type.replace('_', ' ')} {subject}".strip()
