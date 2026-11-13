"""Tags — one shared vocabulary, applied to anything (§37).
See docs/architecture/backend/tags.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "checks": (
        "MAX_NAME", "MAX_DESCRIPTION", "MAX_PER_RECORD", "CATEGORIES", "slugify", "_object",
        "_wanted", "_name", "_description", "_colour", "_category", "_load", "_record", "_state",
        "_serialize",
    ),
    "derived": ("_resync", "_resync_everything_tagged", "_recount"),
    "tag_admin": ("MANAGE_PERMISSION", "APPLY_PERMISSION", "vocabulary", "create", "update"),
    "tagging": ("remove", "on_record", "apply"),
})
