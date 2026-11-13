"""Connected systems (§26): what this platform talks to, and whether it works.
See docs/architecture/backend/integrations.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "redaction": (
        "PERMISSION", "_SECRETISH", "REDACTED", "_SETTING", "_fields", "DEFAULT_COLUMNS",
        "_statement", "missing_settings", "state", "_visible_configuration", "summarise",
    ),
    "listing_view": ("catalogue", "listing", "_integration", "entry"),
    "configuration": ("configure", "set_enabled"),
    "connectivity": ("check",),
})
