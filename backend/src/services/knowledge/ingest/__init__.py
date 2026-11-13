"""Reading a document into passages a question can find (§44).
See docs/architecture/backend/ingest.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "model": (
        "TARGET", "HARD_LIMIT", "EMBED_BATCH", "MAX_EMBEDDED", "EMBED_CHARS", "TEXT_EXTENSIONS",
        "DOCLING_EXTENSIONS", "SUPPORTED_EXTENSIONS", "JOB_KIND", "JOB_QUEUE", "IngestError",
        "Section", "Parsed",
    ),
    "parsing": (
        "Converter", "docling_convert", "_converter", "set_converter", "parse", "parse_text",
    ),
    "chunking": ("chunk", "_passage", "_split_long", "_split_table"),
    "embedding": ("embed", "embed_query", "store", "_embedding_text"),
    "queueing": ("_line", "queue", "_reference", "start", "run"),
})
