"""The live WebSocket endpoint (§17).

Mounted directly on the Flask app rather than through QF's router, because QF
generates Flask-RESTX *resources* and a WebSocket is not a request/response
resource. Everything else about it is ordinary: the same access token, the same
principal, the same permission model.

Authentication is the part worth reading. A browser's `WebSocket` constructor
cannot set an `Authorization` header, so the token arrives one of two ways:

* the `Sec-WebSocket-Protocol` header, which the browser *can* set — the
  standard workaround, and the one used here; or
* a `?token=` query parameter, accepted as a fallback and deliberately second,
  because query strings end up in access logs.

The socket is closed the moment the token fails to verify. An unauthenticated
socket that is merely "not subscribed to anything" is one refactor away from
being subscribed to everything.
"""

from __future__ import annotations

import json
from typing import Any

from src.core.clock import iso, now

#: How long to wait for a client frame before sending a heartbeat. Proxies drop
#: idle connections at around 60s, so this has to be comfortably under that.
HEARTBEAT_SECONDS = 25


def _token_from(request) -> str | None:
    """The access token, from the subprotocol header or the query string."""
    protocols = request.headers.get("Sec-WebSocket-Protocol", "")
    for part in (piece.strip() for piece in protocols.split(",")):
        # Convention: the client sends ["bearer", "<token>"].
        if part and part.lower() not in ("bearer", "authorization"):
            return part
    return request.args.get("token")


def register(app, sock) -> None:
    """Mount `/{API_PREFIX}/live` on the app."""
    from framework.commons.logger import logger as log

    from src.config import Config
    from src.core.auth import verify_token, _principal_from_claims
    from src.services import live

    route = f"{Config.API_PREFIX.rstrip('/')}/live"

    @sock.route(route)
    def live_socket(ws):  # pragma: no cover - exercised end to end, not in unit tests
        from flask import request

        token = _token_from(request)
        if not token:
            ws.send(json.dumps({"type": "error", "error": "unauthorized",
                                "message": "A token is required."}))
            return

        try:
            claims = verify_token(token)
            principal = _principal_from_claims(claims)
        except Exception as exc:
            ws.send(json.dumps({"type": "error", "error": "unauthorized", "message": str(exc)[:200]}))
            return

        live.subscribe(principal.user_id, ws)
        log.debug(f"live: {principal.username} connected ({live.connection_count()} open)")

        try:
            ws.send(json.dumps({
                "type": "ready",
                "user_id": str(principal.user_id),
                "server_time": iso(now()),
                "heartbeat_seconds": HEARTBEAT_SECONDS,
            }))

            # The read loop is what keeps the connection open and detects a
            # browser that went away without closing cleanly. Anything the
            # client sends that is not a pong is ignored: this channel is for
            # delivery, and a socket that accepts commands is an API without
            # any of the API's checks.
            while True:
                message = ws.receive(timeout=HEARTBEAT_SECONDS)
                if message is None:
                    ws.send(json.dumps({"type": "ping", "at": iso(now())}))
                    continue
                if message == "pong":
                    continue
        except Exception as exc:
            log.debug(f"live: connection closed for {principal.username}: {exc}")
        finally:
            live.unsubscribe(principal.user_id, ws)

    log.info(f"live: websocket mounted at {route}", "cyan")


def health() -> dict[str, Any]:
    from src.services import live

    return live.health()
