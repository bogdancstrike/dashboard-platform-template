"""The file manager (§20).
See docs/architecture/backend/files.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "browsing": ("VIEW_PERMISSION", "MANAGE_PERMISSION", "UPLOADING", "READY", "tree", "listing"),
    "uploads": ("begin_upload", "confirm_upload", "receive_bytes", "download_url"),
    "changes": ("update", "remove", "create_folder", "remove_folder"),
    "serializers": ("_KINDS", "_kind_for", "_file", "_folder_of", "_serialize"),
})
