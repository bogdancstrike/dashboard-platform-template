"""Audit actions, secret redaction, JSON-safe values and diffs."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from src.core.clock import iso

#: Actions the UI offers as filters. Free-form strings are still accepted —
#: this is the vocabulary, not a constraint.
ACTIONS = (
    "LOGIN", "LOGOUT", "LOGIN_FAILED", "CREATE", "UPDATE", "DELETE",
    "EXPORT", "IMPORT", "DOWNLOAD", "UPLOAD", "VIEW",
    "PERMISSION_CHANGE", "CONFIGURATION_CHANGE", "STATUS_CHANGE",
    "BULK_UPDATE", "BULK_DELETE", "IMPERSONATE", "SESSION_REVOKE",
    "CREDENTIAL_CREATE", "CREDENTIAL_REVOKE", "CREDENTIAL_ROTATE",
    "JOB_RETRY", "JOB_CANCEL", "COMMENT", "ASSIGN", "SHARE",
    # A question put to the model, and an action it proposed that a person
    # then confirmed (§41–46).
    "AI_REQUEST", "AI_ACTION",
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
    return {
        key: (MASK if is_secret(key) else jsonable(value)) for key, value in payload.items()
    }


def jsonable(value: Any) -> Any:
    """A value PostgreSQL will accept into a JSONB column.

    Here rather than in every caller because the failure mode is a 500 at the
    INSERT, a long way from the `after={...}` that caused it — a service that
    passed a `datetime` in its state dict looked completely correct and broke
    every audited write on that endpoint. Coercing centrally means a service
    can hand over the values it has.

    Deliberately not `json.dumps(default=str)`: that would stringify a nested
    object into something unreadable in the audit drawer. Instants become ISO
    strings, ids and decimals become strings, containers are walked, and
    anything else is left to psycopg2 — which handles the JSON primitives and
    is right to refuse the rest.
    """
    from datetime import date, datetime
    from decimal import Decimal

    if isinstance(value, (datetime, date)):
        return iso(value)
    if isinstance(value, (UUID, Decimal)):
        return str(value)
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [jsonable(item) for item in value]
    return value


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
