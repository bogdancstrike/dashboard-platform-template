"""Ask your documents (§44): collections of files, retrieval, and questions answered with citations.
See docs/architecture/backend/knowledge.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "access": (
        "FEATURE", "USE_PERMISSION", "MANAGE_PERMISSION", "KIND", "ROOT_FOLDER", "SOURCES",
        "CANDIDATES", "RRF_K", "HISTORY_TURNS", "MAX_QUESTION", "MAX_ADD", "MAX_DOCUMENT_BYTES",
        "STALL_MINUTES", "COLORS", "_visible", "visible_ids", "_collection", "_owned", "_counts",
        "_serialize_collection",
    ),
    "library": (
        "listing", "detail", "create", "update", "remove", "_name", "_color", "_folder_for",
        "overview",
    ),
    "document_store": (
        "_stalled", "serialize_document", "documents", "add_documents", "storage_extension",
        "start_pending", "_document", "document_detail", "reprocess", "remove_document",
    ),
    "retrieval": ("passage", "search", "_STOP", "_terms", "_source"),
    "asking": (
        "SYSTEM_PROMPT", "ask", "_thread", "_prompt", "_MARKER", "cite", "_citation",
        "_strip_markers", "_extractive", "serialize_question",
    ),
    "threads": ("history", "forget_thread", "suggestions"),
})
