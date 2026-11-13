"""Files, folders, the mailbox, comments and tags."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "inbox": (
        "RESOURCE_TYPES", "SUBFOLDER_NAMES", "GUARANTEED_INBOX", "inbox_thread",
        "_cover_every_persona_inbox",
    ),
    "mailbox": ("_mailbox",),
    "files": ("_files", "_email_templates"),
    "comments": ("_folders", "_comments"),
    "folders": ("build", "_tags", "_tag_links", "dedupe_folders"),
})
