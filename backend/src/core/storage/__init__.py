"""Where the bytes live, behind one interface (§20, §29, §30).
See docs/architecture/backend/storage.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "base": (
        "CONNECT_TIMEOUT_SECONDS", "READ_TIMEOUT_SECONDS", "_unreachable", "URL_TTL_SECONDS",
        "MAX_UPLOAD_BYTES", "REFUSED_EXTENSIONS", "SignedUrl", "StoredObject", "Storage",
    ),
    "keys": ("key_for", "extension_of", "content_type_for", "refuse_unacceptable"),
    "object_storage": ("ObjectStorage",),
    "local": ("LocalStorage", "_store", "for_config"),
})
