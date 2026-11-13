"""Live delivery over WebSocket (§17), with a Redis fan-out behind it.

Rationale: docs/architecture/backend/modules/services-collaboration-live.md
"""

from __future__ import annotations

import json
import threading
from collections import defaultdict
from typing import Any
from uuid import UUID, uuid4

from src.config import Config

#: The channel every process subscribes to. One channel with the recipient in
#: the payload, rather than a channel per user: a platform with 5 000 users
#: would otherwise hold 5 000 subscriptions open to deliver a handful of
#: messages a minute.
CHANNEL = "nucleus:live"

#: user id → the sockets that user currently has open. A person with the app in
#: three tabs has three, and all three should light up.
_subscribers: dict[str, set[Any]] = defaultdict(set)
_lock = threading.Lock()
_relay_started = False
#: Who published a relayed message, so a worker skips the copy of its own
#: publish that comes back through Redis — it already delivered that locally.
ORIGIN = uuid4().hex


def subscribe(user_id: UUID | str, socket: Any) -> None:
    with _lock:
        _subscribers[str(user_id)].add(socket)


def unsubscribe(user_id: UUID | str, socket: Any) -> None:
    with _lock:
        sockets = _subscribers.get(str(user_id))
        if not sockets:
            return
        sockets.discard(socket)
        if not sockets:
            _subscribers.pop(str(user_id), None)


def connection_count(user_id: UUID | str | None = None) -> int:
    with _lock:
        if user_id is None:
            return sum(len(sockets) for sockets in _subscribers.values())
        return len(_subscribers.get(str(user_id), ()))


def _deliver_locally(user_id: str, payload: dict[str, Any]) -> int:
    """Send to this process's sockets. Never raises."""
    from framework.commons.logger import logger as log

    with _lock:
        sockets = list(_subscribers.get(str(user_id), ()))

    message = json.dumps(payload, default=str)
    delivered = 0
    for socket in sockets:
        try:
            socket.send(message)
            delivered += 1
        except Exception as exc:
            # A browser that closed between the lookup and the send is normal,
            # not an error worth failing a request over.
            log.debug(f"live: dropping a closed socket for {user_id}: {exc}")
            unsubscribe(user_id, socket)
    return delivered


def publish_to_user(user_id: UUID | str, payload: dict[str, Any]) -> int:
    """Deliver here, and ask every other worker to deliver there.

    Best-effort by contract: the caller is in the middle of a database write
    and must not fail because a cache is down or a browser went away.
    """
    from framework.commons.logger import logger as log

    delivered = _deliver_locally(str(user_id), payload)

    from src.core import cache

    client = cache.client()
    if client is not None:
        try:
            client.publish(CHANNEL, json.dumps({"user_id": str(user_id), "payload": payload, "origin": ORIGIN},
                                               default=str))
        except Exception as exc:
            log.debug(f"live: fan-out unavailable, delivering locally only: {exc}")
    return delivered


#: The recipient a broadcast carries through the relay: every socket, on every
#: worker. Used for hints that name no private content — somebody came online,
#: a record's thread changed — so delivering them widely discloses nothing.
EVERYONE = "*"


def connected_user_ids() -> list[str]:
    """The people with a socket open on *this* worker."""
    with _lock:
        return list(_subscribers)


def _deliver_to_everyone(payload: dict[str, Any]) -> int:
    return sum(_deliver_locally(user_id, payload) for user_id in connected_user_ids())


def publish_to_all(payload: dict[str, Any]) -> int:
    """Deliver a hint to everybody connected, here and on every other worker."""
    from framework.commons.logger import logger as log

    delivered = _deliver_to_everyone(payload)

    from src.core import cache

    client = cache.client()
    if client is not None:
        try:
            client.publish(CHANNEL, json.dumps({"user_id": EVERYONE, "payload": payload, "origin": ORIGIN},
                                               default=str))
        except Exception as exc:
            log.debug(f"live: fan-out unavailable, delivering locally only: {exc}")
    return delivered


def relay(body: dict[str, Any]) -> int:
    """Deliver one message another worker published."""
    if body.get("origin") == ORIGIN:
        return 0
    if body["user_id"] == EVERYONE:
        return _deliver_to_everyone(body["payload"])
    return _deliver_locally(body["user_id"], body["payload"])


def start_relay() -> bool:
    """Listen for messages other workers published, once per process.

    Returns whether the relay is running, so a health check can say whether
    cross-worker delivery is actually available rather than assuming it.
    """
    global _relay_started
    from framework.commons.logger import logger as log

    if _relay_started:
        return True

    from src.core import cache

    client = cache.client()
    if client is None:
        log.info("live: no cache, so delivery is same-worker only", "yellow")
        return False

    def _run() -> None:
        try:
            pubsub = client.pubsub(ignore_subscribe_messages=True)
            pubsub.subscribe(CHANNEL)
            for message in pubsub.listen():
                try:
                    relay(json.loads(message["data"]))
                except Exception as exc:  # pragma: no cover - a malformed message
                    log.warning(f"live: could not relay a message: {exc}")
        except Exception as exc:  # pragma: no cover - connection lost
            global _relay_started
            _relay_started = False
            log.warning(f"live: relay stopped, delivery is local until restart: {exc}")

    thread = threading.Thread(target=_run, name="nucleus-live-relay", daemon=True)
    thread.start()
    _relay_started = True
    log.info("live: cross-worker relay listening", "green")
    return True


def health() -> dict[str, Any]:
    return {
        "connections": connection_count(),
        "users": len(_subscribers),
        "cross_worker_relay": _relay_started,
        "enabled": Config.CACHE_ENABLED,
    }
