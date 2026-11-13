"""Rotating, revoking and removing credentials and clients."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.clock import iso, now
from src.core.errors import ConflictError, NotFoundError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.services.platform.api_clients.credentials import (
    PERMISSION,
    ROTATION_GRACE_DAYS,
    _mint,
    credential_state,
    summarise_credential,
)
from src.services.platform.api_clients.reads import _client


def rotate(session, client_id: str, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Mint a new credential, and give the old one a deadline.

    Not a replacement: the previous key keeps working for
    `ROTATION_GRACE_DAYS`, because a rotation that killed it the instant a new
    one was minted is an outage with extra steps — every caller holding the old
    secret fails until somebody redeploys them. And not left forever either, or
    "rotate" would just mean "mint a second key": the old one is given an
    expiry, so the deadline is real and visible.

    `rotated_from` records the chain, which is what makes "how old is the key
    this service is using" a question with an answer.
    """
    principal.require(PERMISSION)
    from datetime import timedelta

    from src.models.platform import ApiCredential

    row = _client(session, client_id)
    replacing_id = payload.get("credential_id")
    replacing = None
    if replacing_id:
        replacing = session.get(ApiCredential, parse_uuid(str(replacing_id), field="credential_id"))
        if replacing is None or replacing.api_client_id != row.id:
            raise NotFoundError("That credential does not belong to this client.")
        if credential_state(replacing) == "REVOKED":
            raise ConflictError(
                f"{replacing.prefix}… was revoked, so there is nothing to rotate. "
                "Add a new credential instead.",
                details={"state": "REVOKED"},
            )

    plaintext, prefix, hashed = _mint()
    credential = ApiCredential(
        api_client_id=row.id,
        label=str(payload.get("label") or f"Rotated {iso(now())[:10]}").strip()[:120],
        prefix=prefix,
        secret_hash=hashed,
        status="ACTIVE",
        created_by_id=principal.user_id,
        rotated_from_id=replacing.id if replacing else None,
    )
    session.add(credential)

    deadline = None
    if replacing is not None:
        deadline = now() + timedelta(days=ROTATION_GRACE_DAYS)
        # Never pushed *out*: if the old key already expires sooner than the
        # grace period, rotating must not extend its life.
        if replacing.expires_at is None or replacing.expires_at > deadline:
            replacing.expires_at = deadline

    session.flush()
    audit.record(
        session,
        action="CREATE",
        resource_type="api_credential",
        resource_id=credential.id,
        resource_label=f"{row.name}: {credential.label}",
        principal=principal,
        after={"prefix": credential.prefix, "rotated_from": replacing.prefix if replacing else None},
        message=(
            f"rotated {row.name}"
            + (f" — {replacing.prefix}… expires {iso(deadline)[:10]}" if replacing else "")
        ),
    )
    return {
        "credential": summarise_credential(credential),
        "secret": plaintext,
        "secret_shown_once": True,
        "replaced": summarise_credential(replacing) if replacing else None,
        "grace_days": ROTATION_GRACE_DAYS if replacing else None,
    }


def revoke(session, credential_id: str, *, principal) -> dict[str, Any]:
    """Kill a credential now, and keep the row.

    Revocation is what somebody does when a key has leaked, and the question
    afterwards is always *when, and by whom* — a row that vanished answers
    neither. Refused a second time rather than silently accepted, because
    "revoke" twice suggests the first one did not take.
    """
    principal.require(PERMISSION)
    from src.models.platform import ApiCredential

    row = get_or_404(
        session,
        ApiCredential,
        parse_uuid(credential_id, field="id"),
        "That credential does not exist.",
    )
    if row.revoked_at is not None:
        raise ConflictError(
            f"{row.prefix}… was already revoked {iso(row.revoked_at)[:10]}.",
            details={"revoked_at": iso(row.revoked_at)},
        )

    moment = now()
    row.revoked_at = moment
    row.revoked_by_id = principal.user_id
    row.status = "REVOKED"

    audit.record(
        session,
        action="DELETE",
        resource_type="api_credential",
        resource_id=row.id,
        resource_label=f"{row.prefix}…",
        principal=principal,
        before={"state": "ACTIVE"},
        after={"state": "REVOKED"},
        message=f"revoked {row.prefix}…",
    )
    session.flush()
    return summarise_credential(row)


def remove(session, client_id: str, *, principal) -> dict[str, Any]:
    """Retire a client, revoking every credential it holds.

    The revocation is the point. A soft-deleted client whose credentials stayed
    live would be a consumer nothing lists any more, still able to call — which
    is the worst of both, and exactly the shape of bug a retired *group* had.
    """
    principal.require(PERMISSION)
    from src.models.platform import ApiCredential

    row = _client(session, client_id)
    moment = now()
    live = [
        item
        for item in session.scalars(
            select(ApiCredential).where(ApiCredential.api_client_id == row.id)
        ).all()
        if credential_state(item) == "ACTIVE"
    ]
    for item in live:
        item.revoked_at = moment
        item.revoked_by_id = principal.user_id
        item.status = "REVOKED"

    label = row.name
    row.deleted_at = moment
    row.status = "REVOKED"

    audit.record(
        session,
        action="DELETE",
        resource_type="api_client",
        resource_id=row.id,
        resource_label=label,
        principal=principal,
        before={"live_credentials": len(live)},
        message=f"retired {label}, revoking {len(live)} live "
        + ("credential" if len(live) == 1 else "credentials"),
    )
    session.flush()
    return {
        "deleted": True,
        "id": str(row.id),
        "name": label,
        "credentials_revoked": len(live),
    }
