"""Presence state: local or Redis, connections, broadcasting."""

from __future__ import annotations

import threading
import time
from uuid import UUID

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
    from src.services.collaboration import live

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
