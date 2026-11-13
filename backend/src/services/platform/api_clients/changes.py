"""Creating and changing clients."""

from __future__ import annotations

import secrets
from typing import Any

from src.core import audit, vocabulary
from src.core.errors import ValidationError
from src.services.platform.api_clients.credentials import (
    _NAME,
    PERMISSION,
    _checked,
    _checked_scopes,
    _mint,
    summarise_credential,
)
from src.services.platform.api_clients.reads import _client, _counts, summarise


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Register a client, and mint its first credential.

    The response carries the plaintext secret. It is the only time it exists
    outside the caller's memory: only the hash is stored, so there is nothing
    to show a second time — which the answer says in the same breath rather
    than leaving somebody to discover it.
    """
    principal.require(PERMISSION)
    from src.models.platform import ApiClient, ApiCredential

    name = _checked(payload.get("name"), _NAME, "client name")
    scopes = _checked_scopes(payload.get("scopes"), principal=principal)

    client_id = f"nuc-{secrets.token_hex(8)}"
    row = ApiClient(
        name=name,
        client_id=client_id,
        description=str(payload.get("description") or "").strip() or None,
        status="ACTIVE",
        owner_id=principal.user_id,
        organization_id=principal.organization_id,
        scopes=scopes,
        rate_limit_per_minute=_bounded(payload.get("rate_limit_per_minute"), 600, 1, 100_000),
        quota_per_day=_bounded(payload.get("quota_per_day"), 100_000, 1, 100_000_000),
        allowed_ips=[str(item).strip() for item in (payload.get("allowed_ips") or [])
                     if item is not None and str(item).strip()],
        requests_today=0,
        requests_total=0,
        error_rate=0,
    )
    session.add(row)
    session.flush()

    plaintext, prefix, hashed = _mint()
    credential = ApiCredential(
        api_client_id=row.id,
        label=str(payload.get("credential_label") or "Initial key").strip()[:120],
        prefix=prefix,
        secret_hash=hashed,
        status="ACTIVE",
        created_by_id=principal.user_id,
    )
    session.add(credential)
    session.flush()

    audit.record(
        session,
        action="CREATE",
        resource_type="api_client",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        after={"client_id": row.client_id, "scopes": scopes},
        # The scopes, named: "created an API client" without them is an audit
        # entry that does not record what was granted.
        message=f"registered {row.name} with " + (", ".join(scopes) if scopes else "no scopes"),
    )
    return {
        **summarise(row, credentials=1, live=1),
        "credential": summarise_credential(credential),
        # Once. There is no endpoint that can return this again.
        "secret": plaintext,
        "secret_shown_once": True,
    }


def _bounded(value: Any, default: int, low: int, high: int) -> int:
    if value is None:
        return default
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValidationError("That must be a whole number.") from None
    if not low <= number <= high:
        raise ValidationError(
            f"That must be between {low} and {high}.",
            details={"minimum": low, "maximum": high, "value": number},
        )
    return number


def update(session, client_id: str, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Edit a client: its name, its scopes, its limits, its addresses."""
    principal.require(PERMISSION)
    row = _client(session, client_id)

    before = {"name": row.name, "scopes": sorted(row.scopes or []), "status": row.status}
    if "name" in payload:
        row.name = _checked(payload.get("name"), _NAME, "client name")
    if "description" in payload:
        row.description = str(payload.get("description") or "").strip() or None
    if "scopes" in payload:
        row.scopes = _checked_scopes(payload.get("scopes"), principal=principal)
    if "status" in payload:
        wanted = str(payload.get("status") or "").strip().upper()
        if wanted not in vocabulary.API_CLIENT_STATUS:
            raise ValidationError(
                f"{wanted!r} is not a client status.",
                details={"allowed": list(vocabulary.API_CLIENT_STATUS)},
            )
        row.status = wanted
    if "rate_limit_per_minute" in payload:
        row.rate_limit_per_minute = _bounded(
            payload.get("rate_limit_per_minute"), row.rate_limit_per_minute, 1, 100_000
        )
    if "quota_per_day" in payload:
        row.quota_per_day = _bounded(
            payload.get("quota_per_day"), row.quota_per_day, 1, 100_000_000
        )
    if "allowed_ips" in payload:
        # A JSON null is "no address", not the address "None".
        row.allowed_ips = [
            str(item).strip() for item in (payload.get("allowed_ips") or [])
            if item is not None and str(item).strip()
        ]

    after = {"name": row.name, "scopes": sorted(row.scopes or []), "status": row.status}
    audit.record(
        session,
        action="UPDATE",
        resource_type="api_client",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        before=before,
        after=after,
        message=_change_sentence(row.name, before, after),
    )
    session.flush()
    counted, live = _counts(session, [row.id])
    return summarise(row, credentials=counted.get(row.id, 0), live=live.get(row.id, 0))


def _change_sentence(name: str, before: dict[str, Any], after: dict[str, Any]) -> str:
    """What moved, in words.

    "updated an API client" is the audit message nobody can act on; a scope
    that was added is the thing a security review is looking for.
    """
    added = sorted(set(after["scopes"]) - set(before["scopes"]))
    removed = sorted(set(before["scopes"]) - set(after["scopes"]))
    parts = []
    if added:
        parts.append(f"+{', '.join(added)}")
    if removed:
        parts.append(f"-{', '.join(removed)}")
    if before["status"] != after["status"]:
        parts.append(f"{before['status'].lower()} → {after['status'].lower()}")
    return f"edited {name}" + (f" ({'; '.join(parts)})" if parts else "")
