"""The approvals inbox: one queue for everything that needs a decision.
See docs/architecture/backend/approvals.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "registry": (
        "REFERENCE_PREFIX", "STATUSES", "DECISIONS", "MAX_BULK", "Provider", "_PROVIDERS",
        "register", "providers", "provider_for", "_reference", "_event", "deciders",
    ),
    "submission": ("submit",),
    "inbox": (
        "can_decide", "_person", "serialize", "_visible", "_inbox", "_pending_badge",
        "pending_count", "SCOPES", "SORTS",
    ),
    "listing_view": ("listing", "_requester_facet", "_load", "entry"),
    "deciding": ("_decide_row", "decide", "decide_many", "withdraw", "find_pending", "as_uuid"),
})
