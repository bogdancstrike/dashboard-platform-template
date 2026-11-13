"""The developer portal (§31): an API reference read from the platform itself.
See docs/architecture/backend/developer-portal.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "guards": (
        "USAGE_PERMISSION", "SAMPLE_ITEMS", "SAMPLE_CHARS", "SAMPLE_DEPTH", "_PARAM", "CHANGELOG",
        "_guard", "_group", "_swagger", "_SWAGGER", "_swagger_path",
    ),
    "api_reference": ("reference", "_raw_map", "_example"),
    "examples": ("sample", "infer_schema", "capture"),
    "usage_view": ("usage",),
})
