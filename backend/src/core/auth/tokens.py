"""Access-token verification against the realm's JWKS, with a short claims cache."""

from __future__ import annotations

import hashlib
import threading
import time
from typing import Any

import requests
from jose import jwt
from jose.exceptions import JWTError

from src.config import Config
from src.core.errors import UnauthorizedError


class _JwksCache:
    """Realm signing keys, refreshed on a miss or when stale.

    A cache miss on an unknown `kid` triggers exactly one refresh — that is
    what makes a Keycloak key rotation self-healing instead of a restart.
    """

    #: After a failed fetch, how long before another is attempted. Without it
    #: an unreachable Keycloak made *every* request with a stale cache try a
    #: fetch — each one a 5 s wait behind the lock when Keycloak hangs rather
    #: than refuses (docs/testing/chaos.md).
    RETRY_SECONDS = 15.0

    def __init__(self) -> None:
        self._keys: dict[str, dict] = {}
        self._fetched_at = 0.0
        self._failed_at = 0.0
        self._lock = threading.Lock()

    def _stale(self) -> bool:
        return (time.time() - self._fetched_at) > Config.JWKS_CACHE_TTL

    def _backing_off(self) -> bool:
        return (time.time() - self._failed_at) < self.RETRY_SECONDS

    def get(self, kid: str) -> dict | None:
        if kid in self._keys and not self._stale():
            return self._keys[kid]
        if not self._backing_off():
            self.refresh()
        # A stale key is still the realm's key: Keycloak being unreachable
        # must not sign everybody out, so the last keys fetched keep working
        # until a fetch succeeds (a rotation is still picked up then).
        return self._keys.get(kid)

    def refresh(self) -> None:
        from framework.commons.logger import logger as log

        url = Config.keycloak_jwks_url()
        with self._lock:
            try:
                response = requests.get(url, timeout=5)
                response.raise_for_status()
                self._keys = {k["kid"]: k for k in response.json().get("keys", [])}
                self._fetched_at = time.time()
                self._failed_at = 0.0
            except Exception as exc:
                self._failed_at = time.time()
                log.warning(f"jwks fetch failed from {url}: {exc}")

    def ready(self) -> bool:
        if not self._keys or self._stale():
            self.refresh()
        return bool(self._keys)


_jwks = _JwksCache()


def verify_token(token: str) -> dict[str, Any]:
    """Verify signature, issuer, audience and expiry. Raises Unauthorized.

    Successful claims are cached in Redis until the JWT itself expires. The
    cache key is a SHA-256 digest, never the bearer token, so neither Redis keys
    nor values expose a reusable credential. Cache failure is only a miss.
    """
    if not token:
        raise UnauthorizedError("Authentication required.")

    from src.core import cache

    cache_key = _token_cache_key(token)
    cached = cache.get_json(cache_key)
    current_time = time.time()
    if isinstance(cached, dict) and _expiry(cached) > current_time:
        return cached

    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise UnauthorizedError("Malformed authentication token.") from exc

    kid = header.get("kid")
    if not kid:
        raise UnauthorizedError("Token is missing a key id.")
    key = _jwks.get(kid)
    if key is None:
        raise UnauthorizedError("Token was signed by an unknown key.")

    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=[key.get("alg", "RS256")],
            audience=Config.KEYCLOAK_AUDIENCE,
            issuer=Config.keycloak_issuer(),
            options={
                "verify_at_hash": False,
                # Keycloak puts the SPA client in `azp`, not `aud`; the audience
                # mapper supplies `aud`. Both are checked above.
                "leeway": Config.JWT_LEEWAY_SECONDS,
            },
        )
        seconds_left = int(_expiry(claims) - current_time)
        if seconds_left > 0:
            cache.set_json(cache_key, claims, ttl=seconds_left)
        return claims
    except JWTError as exc:
        message = str(exc)
        if "expired" in message.lower():
            raise UnauthorizedError("Your session has expired. Sign in again.") from exc
        raise UnauthorizedError(f"Token verification failed: {message}") from exc


def _token_cache_key(token: str) -> str:
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return f"{Config.SERVICE_NAME}:auth:token:{digest}"


def _expiry(claims: dict[str, Any]) -> float:
    try:
        return float(claims.get("exp") or 0)
    except (TypeError, ValueError):
        return 0.0


def auth_health() -> dict[str, Any]:
    """Whether the realm's keys are reachable — surfaced on §24."""
    started = time.perf_counter()
    ok = _jwks.ready()
    return {
        "status": "healthy" if ok else "unavailable",
        "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        "issuer": Config.keycloak_issuer(),
        "realm": Config.KEYCLOAK_REALM,
    }
