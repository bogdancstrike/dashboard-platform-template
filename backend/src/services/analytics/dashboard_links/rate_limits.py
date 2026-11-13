"""Per-link rate limits and the signed unlock grant."""

from __future__ import annotations

import threading
import time

from src.core import cache
from src.core.errors import RateLimitedError
from src.services.analytics.dashboard_links.link_state import GRANT_SECONDS

_local_counts: dict[str, tuple[float, int]] = {}


_local_lock = threading.Lock()


def _hit(key: str, *, window: int) -> int:
    """Count one hit in a fixed window; Redis when there is one."""
    counted = cache.incr(f"public-dash:{key}", ttl=window)
    if counted:
        return counted
    bucket = int(time.time() // window)
    with _local_lock:
        started, count = _local_counts.get(key, (bucket, 0))
        if started != bucket:
            started, count = bucket, 0
        count += 1
        _local_counts[key] = (started, count)
        if len(_local_counts) > 10_000:  # pragma: no cover - a flood of distinct keys
            _local_counts.clear()
        return count


def _limit(key: str, *, limit: int, window: int) -> None:
    if _hit(key, window=window) > limit:
        raise RateLimitedError("Too many requests — wait a minute and try again.",
                               details={"limit": limit, "window_seconds": window})


def _serializer():
    from itsdangerous import URLSafeTimedSerializer

    from src.config import Config

    return URLSafeTimedSerializer(Config.SECRET_KEY, salt="nucleus-public-dashboard")


def _granted(row, grant: str | None) -> bool:
    if not row.password_hash:
        return True
    if not grant:
        return False
    from itsdangerous import BadSignature, SignatureExpired

    try:
        claims = _serializer().loads(grant, max_age=GRANT_SECONDS)
    except (BadSignature, SignatureExpired):
        return False
    return claims.get("link") == str(row.id) and int(claims.get("v", -1)) == int(row.password_version or 0)
