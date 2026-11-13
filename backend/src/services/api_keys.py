"""Calling the platform with an API client's key, and counting what it did (§25, §31).

API clients and their credentials existed — minted, rotated, revoked — but no
request could actually authenticate with one, so the usage charts had nothing
true to draw. This is the missing half:

* **`principal_for_key`** turns an `X-Api-Key` header into a principal. The key
  is found by its stored prefix and checked against its hash; a revoked or
  expired key, a suspended or deleted client, an address outside its allow-list
  or a client over its per-minute limit is refused. The principal acts as the
  client's *owner*, holding only the permissions both the owner and the client's
  scopes grant — a key can never do more than the person who made it.
* **`capture` / `record_usage`** write one `api_request_logs` row per keyed
  request, after the response, in its own transaction, swallowing every
  failure — the same rules as the request log (`core/logsink`), because a
  usage counter must never turn a working request into a 500.
"""

from __future__ import annotations

import hashlib
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select

from src.core.clock import now
from src.core.errors import ForbiddenError, RateLimitedError, UnauthorizedError

HEADER = "X-Api-Key"
PREFIX = "nuc_"
PREFIX_LENGTH = len(PREFIX) + 8

#: `last_used_at` is written at most this often per credential.
TOUCH_SECONDS = 60


def _hash(plaintext: str) -> str:
    return f"sha256${hashlib.sha256(plaintext.encode()).hexdigest()}"


def principal_for_key(plaintext: str, *, address: str | None = None):
    """The principal an API key acts as, or a refusal saying why not."""
    from src.core.auth import Principal, _permissions_for
    from src.core.db import session_scope
    from src.models.platform import ApiClient, ApiCredential, ApiRequestLog

    key = (plaintext or "").strip()
    if not key.startswith(PREFIX) or len(key) < PREFIX_LENGTH + 8:
        raise UnauthorizedError("That API key is not one this platform issued.")
    with session_scope() as session:
        credential = next(
            (row for row in session.scalars(
                select(ApiCredential).where(ApiCredential.prefix == key[:PREFIX_LENGTH])
            ).all() if row.secret_hash == _hash(key)),
            None,
        )
        if credential is None:
            raise UnauthorizedError("That API key is not one this platform issued.")
        moment = now()
        if credential.revoked_at is not None or credential.status != "ACTIVE":
            raise UnauthorizedError("That API key has been revoked.")
        if credential.expires_at is not None and credential.expires_at <= moment:
            raise UnauthorizedError("That API key has expired.")
        client = session.get(ApiClient, credential.api_client_id)
        if client is None or client.deleted_at is not None or client.status != "ACTIVE":
            raise UnauthorizedError("That API key's client is not active.")
        if client.allowed_ips and address and address not in client.allowed_ips:
            raise ForbiddenError("Calls with this key are not allowed from your address.",
                                 details={"address": address})
        owner = client.owner
        if owner is None or owner.deleted_at is not None or owner.status != "ACTIVE":
            raise UnauthorizedError("That API key's owner can no longer use it.")
        recent = session.scalar(
            select(func.count()).select_from(ApiRequestLog).where(
                ApiRequestLog.api_client_id == client.id,
                ApiRequestLog.requested_at > moment - timedelta(minutes=1),
            )
        ) or 0
        if client.rate_limit_per_minute and recent >= client.rate_limit_per_minute:
            raise RateLimitedError("This API client is over its per-minute limit.",
                                   details={"limit": client.rate_limit_per_minute})
        held = _permissions_for(session, owner, owner.role.code if owner.role else "VIEWER")
        scopes = set(client.scopes or [])
        if credential.last_used_at is None or (moment - credential.last_used_at).total_seconds() > TOUCH_SECONDS:
            credential.last_used_at = moment
        return Principal(
            user_id=owner.id,
            subject=owner.external_id or "",
            email=owner.email,
            username=f"api:{client.client_id}",
            full_name=f"{client.name} (API)"[:160],
            role_code="API_CLIENT",
            permissions=frozenset(held & scopes),
            organization_id=owner.organization_id,
            department_id=owner.department_id,
            session_id=f"api:{credential.id}",
        ), client.id


def capture(status_code: int) -> dict[str, Any] | None:
    """What one keyed request should leave in `api_request_logs`, or None."""
    from time import perf_counter

    from flask import g, request

    client_id = getattr(g, "api_client_id", None)
    if client_id is None:
        return None
    started = getattr(g, "request_started", None)
    return {
        "api_client_id": client_id,
        "requested_at": now(),
        "method": request.method[:8],
        "path": str(request.url_rule or request.path)[:300],
        "status_code": int(status_code),
        "duration_ms": round((perf_counter() - started) * 1000, 2) if started else 0,
        "ip_address": (request.headers.get("X-Forwarded-For") or request.remote_addr or "")[:64] or None,
        "bytes_out": 0,
    }


def record_usage(row: dict[str, Any] | None) -> None:
    """Write the usage row and bump the client's counters; never raises."""
    if not row:
        return
    try:
        from src.core.db import session_scope
        from src.models.platform import ApiClient, ApiRequestLog

        with session_scope() as session:
            session.add(ApiRequestLog(**row))
            client = session.get(ApiClient, row["api_client_id"])
            if client is not None:
                client.requests_total = int(client.requests_total or 0) + 1
                client.requests_today = int(client.requests_today or 0) + 1
                client.last_used_at = row["requested_at"]
    except Exception:  # noqa: BLE001 - a usage count is never worth a 500
        pass
