"""The live channel's per-message feature gate."""

from __future__ import annotations

from src.core.features.evaluation import enabled_map, is_enabled
from src.core.features.gate import live_allowed


class GatedSocket:
    """A live socket that only carries what its reader's features allow.

    `live.subscribe` is handed this instead of the raw socket, so *every*
    publish — chat, typing, presence, notifications — passes one check, and a
    flag switched off mid-connection takes effect on the next message rather
    than on the next reconnect. When `live-updates` itself goes off, the socket
    is closed; the client reconnects, is refused, and falls back to polling.
    """

    def __init__(self, socket, principal):
        self.socket = socket
        self.principal = principal

    def send(self, message: str) -> None:
        import json

        try:
            kind = json.loads(message).get("type")
        except (TypeError, ValueError, AttributeError):
            kind = None
        if kind == "features.changed":
            # Always delivered: it is what tells the client to refetch.
            self.socket.send(message)
            flags = enabled_map(self.principal)
            if not flags.get("live-updates", True):
                self.socket.close()
            return
        flags = enabled_map(self.principal)
        if not flags.get("live-updates", True):
            self.socket.close()
            return
        if live_allowed(kind, flags):
            self.socket.send(message)

    def accepts_frame(self, raw: str) -> bool:
        """Whether a frame the browser sent may be handled (presence is chat's)."""
        return raw == "pong" or is_enabled("chat", self.principal)
