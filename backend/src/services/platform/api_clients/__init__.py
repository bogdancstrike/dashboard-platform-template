"""API clients and their credentials (§25): machines that call the platform.
See docs/architecture/backend/api-clients.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "credentials": (
        "PERMISSION", "ROTATION_GRACE_DAYS", "SECRET_PREFIX", "SECRET_BYTES", "MAX_REQUESTS",
        "_NAME", "_LABEL", "_fields", "DEFAULT_COLUMNS", "_statement", "_checked",
        "_checked_scopes", "_mint", "_hash", "credential_state", "summarise_credential",
    ),
    "reads": ("summarise", "catalogue", "_counts", "listing", "_client", "entry"),
    "changes": ("create", "_bounded", "update", "_change_sentence"),
    "lifecycle": ("rotate", "revoke", "remove"),
})
