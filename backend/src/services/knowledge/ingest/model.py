"""Ingest limits, supported formats, and the parsed-document model."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

#: The passage size a chunk is grown to, in characters (≈ 350 tokens). Small
#: enough that a citation points at a paragraph rather than a chapter.
TARGET = 1400


#: The most a single passage may be, however long a paragraph runs.
HARD_LIMIT = 2400


#: Texts per embeddings request.
EMBED_BATCH = 48


#: The most passages of one document that are embedded. Every AI call costs
#: real money and time; beyond this a document is still found by full-text
#: search, and its warnings say so.
MAX_EMBEDDED = 400


#: What one passage contributes to an embedding request, at most.
EMBED_CHARS = 6000


#: Extensions read here rather than sent to the converter.
TEXT_EXTENSIONS = frozenset({"txt", "md", "markdown", "csv", "tsv", "json", "log", "yaml", "yml", "xml"})


#: What the converter accepts (Docling's own formats; the service checks again).
DOCLING_EXTENSIONS = frozenset({
    "pdf", "docx", "dotx", "pptx", "potx", "xlsx", "xltx", "html", "htm", "xhtml",
    "odt", "ods", "odp", "rtf", "png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp", "epub",
    "adoc", "asciidoc",
})


SUPPORTED_EXTENSIONS = TEXT_EXTENSIONS | DOCLING_EXTENSIONS


#: The job kind ingest runs under, in the jobs console.
JOB_KIND = "INGEST"


JOB_QUEUE = "knowledge"


class IngestError(Exception):
    """A document that cannot be read, with a code the page can explain."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Section:
    text: str
    kind: str = "text"
    heading_path: list[str] = field(default_factory=list)
    page_from: int | None = None
    page_to: int | None = None
    boxes: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class Parsed:
    sections: list[Section]
    pages: int | None = None
    outline: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    parser: str = "docling"
