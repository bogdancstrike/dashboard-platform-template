"""Team chat: channels, direct messages, unread counts and search (§47).
See docs/architecture/backend/chat.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "access": (
        "RESOURCE", "USE", "VISIBILITIES", "MAX_NAME", "MAX_TOPIC", "_NAME", "_channel", "_member",
        "authorise_read", "authorise_write", "label", "audience", "_slug", "_topic", "_users",
        "_taken",
    ),
    "channel_admin": (
        "detail", "create", "direct", "_may_manage", "update", "archive", "join", "_changed",
    ),
    "channel_list": (
        "channels", "_unread_badge", "unread_total", "_unread", "_last_lines", "_people",
        "_summary",
    ),
    "membership": ("leave", "add_members", "remove_member", "search", "presence", "set_presence"),
})
