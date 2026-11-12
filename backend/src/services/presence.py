"""Who is here: online, away, or gone (§47).

Presence rides the live channel. A socket opening says "online"; the browser
says "away" when the tab is hidden or idle and "online" when it comes back;
the last socket closing says "offline". Every change is broadcast as a hint —
`{"type": "presence", "user_id", "status"}` — which discloses nothing a
colleague directory does not already show.

**Workers do not share memory, so the truth is in Redis.** Each user has a
status key and a connection counter, both on a short TTL that the socket's
heartbeat refreshes. A worker that dies without closing its sockets therefore
stops vouching for them within a minute, rather than leaving somebody "online"
until the next deploy. Without Redis the same bookkeeping is kept in process,
which is exact for one worker and good enough for a laptop.
"""

from __future__ import annotations

import threading
import time
from typing import Any
from uuid import UUID

from src.core.errors import ValidationError

#: Seconds a status survives without a heartbeat. The socket pings every 25s.
TTL_SECONDS = 70

STATUSES = ("online", "away")

_PREFIX = "nucleus:presence"

_local_status: dict[str, tuple[str, float]] = {}
_local_connections: dict[str, int] = {}
_lock = threading.Lock()


def _redis():
    from src.core import cache

    return cache.client()


def _status_key(user_id: str) -> str:
    return f"{_PREFIX}:status:{user_id}"


def _conn_key(user_id: str) -> str:
    return f"{_PREFIX}:conn:{user_id}"


def _broadcast(user_id: str, status: str) -> None:
    from src.services import live

    live.publish_to_all({"type": "presence", "user_id": user_id, "status": status})


def _current(user_id: str) -> str:
    client = _redis()
    if client is not None:
        try:
            return client.get(_status_key(user_id)) or "offline"
        except Exception:
            pass
    with _lock:
        entry = _local_status.get(user_id)
    if entry is None or entry[1] < time.monotonic():
        return "offline"
    return entry[0]


def _store(user_id: str, status: str) -> None:
    client = _redis()
    if client is not None:
        try:
            client.set(_status_key(user_id), status, ex=TTL_SECONDS)
            return
        except Exception:
            pass
    with _lock:
        _local_status[user_id] = (status, time.monotonic() + TTL_SECONDS)


def _clear(user_id: str) -> None:
    client = _redis()
    if client is not None:
        try:
            client.delete(_status_key(user_id), _conn_key(user_id))
            return
        except Exception:
            pass
    with _lock:
        _local_status.pop(user_id, None)
        _local_connections.pop(user_id, None)


def _count(user_id: str, delta: int) -> int:
    client = _redis()
    if client is not None:
        try:
            value = int(client.incrby(_conn_key(user_id), delta))
            client.expire(_conn_key(user_id), TTL_SECONDS)
            return value
        except Exception:
            pass
    with _lock:
        value = _local_connections.get(user_id, 0) + delta
        _local_connections[user_id] = value
        return value


def connected(user_id: UUID | str) -> str:
    """A socket opened. The first one makes its owner online."""
    key = str(user_id)
    _count(key, +1)
    before = _current(key)
    status = "online" if before == "offline" else before
    _store(key, status)
    if before != status:
        _broadcast(key, status)
    return status


def heartbeat(user_id: UUID | str) -> None:
    """The socket is still there: keep the status and the counter alive."""
    key = str(user_id)
    status = _current(key)
    _store(key, "online" if status == "offline" else status)
    client = _redis()
    if client is not None:
        try:
            client.expire(_conn_key(key), TTL_SECONDS)
        except Exception:
            pass


def disconnected(user_id: UUID | str) -> str:
    """A socket closed. The last one makes its owner offline."""
    key = str(user_id)
    if _count(key, -1) > 0:
        return _current(key)
    _clear(key)
    _broadcast(key, "offline")
    return "offline"


def set_status(user_id: UUID | str, status: Any) -> dict[str, Any]:
    """The browser's own report: away when hidden or idle, online when back."""
    value = str(status or "").strip().lower()
    if value not in STATUSES:
        raise ValidationError(
            f"status must be one of: {', '.join(STATUSES)}", details={"field": "status"}
        )
    key = str(user_id)
    before = _current(key)
    _store(key, value)
    if before != value:
        _broadcast(key, value)
    return {"user_id": key, "status": value}


def status_of(user_ids: list[str]) -> dict[str, str]:
    """Each named person's status; anybody unknown is offline."""
    ids = [str(item) for item in user_ids if item]
    if not ids:
        return {}
    client = _redis()
    if client is not None:
        try:
            values = client.mget([_status_key(item) for item in ids])
            return {item: value or "offline" for item, value in zip(ids, values)}
        except Exception:
            pass
    return {item: _current(item) for item in ids}


def everyone() -> dict[str, str]:
    """Everybody currently online or away — the roster the chat page draws."""
    client = _redis()
    if client is not None:
        try:
            found: dict[str, str] = {}
            for key in client.scan_iter(match=_status_key("*"), count=500):
                value = client.get(key)
                if value:
                    found[key.rsplit(":", 1)[-1]] = value
            return found
        except Exception:
            pass
    moment = time.monotonic()
    with _lock:
        return {user: status for user, (status, until) in _local_status.items() if until >= moment}


def client_frame(user_id: UUID | str, raw: str) -> bool:
    """Handle a frame the browser sent on the live socket. True if it was ours.

    Only two things are accepted, both about the sender alone: the heartbeat
    reply, and a presence status. Anything else is ignored — a socket that
    accepted commands would be an API without any of the API's checks.
    """
    if raw == "pong":
        heartbeat(user_id)
        return True
    if not raw.startswith("{"):
        return False
    import json

    try:
        frame = json.loads(raw)
    except ValueError:
        return False
    if not isinstance(frame, dict) or frame.get("type") != "presence":
        return False
    try:
        set_status(user_id, frame.get("status"))
    except ValidationError:
        return False
    return True


def reset_for_tests() -> None:
    with _lock:
        _local_status.clear()
        _local_connections.clear()
