"""The current request's caller and body."""

from __future__ import annotations

from typing import Any

from flask import g, request

from src.core.auth import tokens, users
from src.core.auth.api_keys import principal_for_key
from src.core.auth.principal import Principal
from src.core.errors import UnauthorizedError


def _bearer() -> str | None:
    header = request.headers.get("Authorization") or ""
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return None


def principal_from_request(*, required: bool = True) -> Principal | None:
    """Resolve the caller. Cached on `g` — several guards may run per request."""
    cached = getattr(g, "principal", None)
    if cached is not None:
        return cached

    token = _bearer()
    if not token and request.headers.get("X-Api-Key"):
        # A machine calling with an API client's key (§25, §31): it acts as
        # the client's owner, holding only what both owner and scopes grant.
        principal, client_id = principal_for_key(
            request.headers["X-Api-Key"], address=request.remote_addr
        )
        g.api_client_id = client_id
        g.principal = principal
        return principal
    if not token:
        if required:
            raise UnauthorizedError("Authentication required.")
        return None

    claims = tokens.verify_token(token)
    principal = users.principal_from_claims(claims)

    # Impersonation (§12) rides in a header rather than a second token: the
    # admin's own identity stays the one Keycloak proved, and every audit row
    # records both sides. Only an admin may set it.
    target = request.headers.get("X-Impersonate-User")
    if target and principal.can("users.impersonate"):
        principal = users.impersonate(principal, target)

    g.principal = principal
    return principal


def me() -> Principal:
    """The current principal inside an already-guarded handler."""
    principal = getattr(g, "principal", None)
    if principal is None:
        principal = principal_from_request(required=True)
    return principal


def maybe_me() -> Principal | None:
    return getattr(g, "principal", None)


def json_body() -> dict[str, Any]:
    """Parsed request body, tolerant of an empty one."""
    from src.core.errors import ValidationError

    if not request.data:
        return {}
    try:
        body = request.get_json(force=True, silent=False)
    except Exception as exc:
        raise ValidationError("Request body must be valid JSON.") from exc
    if body is None:
        return {}
    if not isinstance(body, dict):
        raise ValidationError("Request body must be a JSON object.")
    return body
