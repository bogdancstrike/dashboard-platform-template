"""Setting and reading someone's status, and everyone's."""

from __future__ import annotations

import time
from typing import Any
from uuid import UUID

from src.core.errors import ValidationError
from src.services.collaboration.presence.store import (
    STATUSES,
    _broadcast,
    _current,
    _local_connections,
    _local_status,
    _lock,
    _redis,
    _status_key,
    _store,
    heartbeat,
)


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
