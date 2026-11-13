"""Comments and threads on records (§47): one conversation model for records, cards, events and chat.
See docs/architecture/backend/comments.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "targets": (
        "WRITE_PERMISSION", "MAX_BODY", "PAGE", "_MENTION", "Commentable", "_kanban_card",
        "_calendar_event", "_chat_channel", "COMMENTABLE", "REACTIONS", "MAX_ATTACHMENTS",
        "_RECORD_PATHS",
    ),
    "access": (
        "_target", "_authorise_existing", "_readable", "_own", "_require_record", "_label",
        "_may_write", "_resource_of", "_link_for",
    ),
    "reading": ("listing", "_serialize", "_bounded_limit", "_moment"),
    "thread_facts": ("_reply_counts", "_names", "_reads"),
    "writing": ("create", "update", "remove", "react"),
    "content": ("_body", "_parent", "_mentioned", "_attachments"),
    "signals": (
        "mark_read", "typing", "_audited", "_mark", "_touch", "_notify_mentions", "_publish",
        "_announce",
    ),
})
