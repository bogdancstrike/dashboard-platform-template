"""The audit trail (§21) and the activity feed (§35), written from one place.

Two records come out of a single call because they answer different questions
and have different lifetimes:

  * **Audit log** — "who changed what, from what, to what, from where". Legal
    and forensic; retained, filterable, never edited.
  * **Activity entry** — "what happened around this project lately". Social and
    contextual; scoped to an entity so a detail page can show its own story.

`record` computes the field-level diff itself rather than trusting callers to
pass one, because a diff assembled by hand is a diff that drifts from what was
actually written.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from src.core.clock import now


#: Actions the UI offers as filters. Free-form strings are still accepted —
#: this is the vocabulary, not a constraint.
ACTIONS = (
    "LOGIN", "LOGOUT", "LOGIN_FAILED", "CREATE", "UPDATE", "DELETE",
    "EXPORT", "IMPORT", "DOWNLOAD", "UPLOAD", "VIEW",
    "PERMISSION_CHANGE", "CONFIGURATION_CHANGE", "STATUS_CHANGE",
    "BULK_UPDATE", "BULK_DELETE", "IMPERSONATE", "SESSION_REVOKE",
    "CREDENTIAL_CREATE", "CREDENTIAL_REVOKE", "CREDENTIAL_ROTATE",
    "JOB_RETRY", "JOB_CANCEL", "COMMENT", "ASSIGN", "SHARE",
)

RESULTS = ("SUCCESS", "FAILURE", "DENIED", "PARTIAL")

#: Never write these into a diff, whatever the caller passes (§76).
_REDACTED = {
    "password", "password_hash", "secret", "secret_hash", "token", "api_key",
    "client_secret", "private_key", "mfa_secret", "recovery_codes",
}


#: What a redacted value looks like wherever one is rendered.
MASK = "••••••••"


def is_secret(key: Any) -> bool:
    """Whether a field name is one whose value must never be stored or shown."""
    return str(key).lower() in _REDACTED


def redact(payload: dict[str, Any] | None) -> dict[str, Any]:
    if not payload:
        return {}
    return {key: (MASK if is_secret(key) else value) for key, value in payload.items()}


def diff(before: dict[str, Any] | None, after: dict[str, Any] | None) -> dict[str, Any]:
    """Only the keys that actually moved, each with both sides.

    Keys present on one side only are reported with the missing side as null,
    which is how "field added" and "field cleared" stay distinguishable in the
    audit drawer.
    """
    before, after = redact(before), redact(after)
    keys = set(before) | set(after)
    changed: dict[str, Any] = {}
    for key in sorted(keys):
        old, new = before.get(key), after.get(key)
        if old != new:
            changed[key] = {"from": old, "to": new}
    return changed


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
