"""Public and embeddable dashboard links (§25), with expiry and passwords.
See docs/architecture/backend/dashboard-links.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "link_state": (
        "MANAGE", "PUBLISH", "GRANT_SECONDS", "VIEW_LIMIT", "UNLOCK_LIMIT", "MAX_ORIGINS",
        "READ_ONLY", "PUBLIC_KINDS", "CHART_FOR", "_owned_dashboard", "_link", "_object", "_apply",
        "_origin", "_status", "_link_dict", "_audit_state",
    ),
    "rate_limits": ("_local_counts", "_local_lock", "_hit", "_limit", "_serializer", "_granted"),
    "answers": ("_live_link", "_Gone", "_gone", "meta", "_owner_principal", "_answer"),
    "links_admin": ("links", "create", "update", "revoke"),
    "public_view": ("unlock", "_embed_allowed", "view"),
})
