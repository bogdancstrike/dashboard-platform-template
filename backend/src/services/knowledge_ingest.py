"""Reading a document into passages a question can find (§44).

The pipeline, per document, off the request (`core/background`):

1. **parse** — the bytes come back from object storage and go to the isolated
   Docling service (`deploy/docling`), which answers with sections that keep
   their page numbers and the boxes they were read from. Plain text, Markdown,
   CSV and JSON are read here instead: there is nothing to lay out.
2. **chunk** — consecutive sections under the same heading *on the same page*
   are joined up to ~1 400 characters. A passage never crosses a page, so a
   citation can always say exactly which page to open and where to mark it.
   Tables are passages of their own, split on rows with the header repeated.
3. **embed** — through the gateway (`nucleus-embed`), in batches. A model that
   is unavailable does not fail the document: it is stored without vectors,
   still found by full-text search, and says so in its warnings.
4. **store** — the old passages are replaced in one transaction.

Each document has a `BackgroundJob` (kind INGEST) so it appears in the jobs
console like any other work, and its own status on the document row for the
collection page to show.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable

import requests
from sqlalchemy import delete, select

from src.config import Config
from src.core import background, storage
from src.core.clock import iso, now
from src.core.db import session_scope

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


# ── parse ────────────────────────────────────────────────────────────────

#: Replaced in tests with a stub; the real one posts to the Docling service.
Converter = Callable[[bytes, str], dict[str, Any]]


def docling_convert(data: bytes, filename: str) -> dict[str, Any]:
    """Send the bytes — never a URL or a key — to the converter."""
    extension = storage.extension_of(filename)
    try:
        response = requests.post(
            f"{Config.DOCLING_URL.rstrip('/')}/convert",
            files={"file": (f"input.{extension}", data, "application/octet-stream")},
            data={"options": json.dumps({"ocr": True, "ocr_langs": "eng"})},
            timeout=(10, Config.DOCLING_TIMEOUT_SECONDS),
        )
    except requests.RequestException as exc:
        raise IngestError(
            "FILE_CONVERTER_UNAVAILABLE",
            "The document converter could not be reached. Reprocess the file when it is running.",
        ) from exc
    if response.status_code == 415:
        raise IngestError("FILE_UNSUPPORTED", "The converter does not read that kind of file.")
    if response.status_code == 413:
        raise IngestError("FILE_TOO_LARGE", "The file is larger than the converter accepts (50 MB).")
    if response.status_code != 200:
        raise IngestError(
            "FILE_CONVERTER_UNAVAILABLE",
            f"The document converter answered {response.status_code}. Reprocess the file when it is healthy.",
        )
    try:
        return response.json()
    except ValueError as exc:
        raise IngestError("FILE_PARSE_ERROR", "The converter's answer could not be read.") from exc


_converter: Converter = docling_convert


def set_converter(converter: Converter | None) -> None:
    """Install a converter (tests); `None` goes back to the Docling service."""
    global _converter
    _converter = converter or docling_convert


def parse(data: bytes, filename: str) -> Parsed:
    extension = storage.extension_of(filename)
    if extension in TEXT_EXTENSIONS:
        return parse_text(data, extension)
    if extension not in DOCLING_EXTENSIONS:
        raise IngestError("FILE_UNSUPPORTED", f"A .{extension or '?'} file cannot be read for questions.")
    answer = _converter(data, filename)
    if not answer.get("ok"):
        code = str(answer.get("code") or "FILE_PARSE_ERROR")
        raise IngestError(code if code.startswith("FILE_") else "FILE_PARSE_ERROR",
                          str(answer.get("detail") or "The document could not be converted.")[:500])
    sections = [
        Section(
            text=str(item.get("text") or ""),
            kind=str(item.get("kind") or "text"),
            heading_path=[str(h) for h in item.get("heading_path") or []],
            page_from=item.get("page_from"),
            page_to=item.get("page_to"),
            boxes=[b for b in item.get("boxes") or [] if isinstance(b, dict)],
        )
        for item in answer.get("sections") or []
        if isinstance(item, dict)
    ]
    return Parsed(
        sections=sections,
        pages=answer.get("pages"),
        outline=list(answer.get("outline") or [])[:200],
        warnings=[str(w) for w in answer.get("warnings") or []],
        parser="docling",
    )


def parse_text(data: bytes, extension: str) -> Parsed:
    """A text file, read here: paragraphs, with Markdown headings as headings."""
    text = data.decode("utf-8", errors="replace")
    if extension in ("csv", "tsv", "json", "log", "yaml", "yml", "xml"):
        # No paragraphs to speak of; lines grouped into passages by the chunker.
        blocks = [line for line in text.splitlines() if line.strip()]
        return Parsed([Section(text=line) for line in blocks], pages=None, parser="text")
    sections: list[Section] = []
    heading: list[str] = []
    outline: list[dict[str, Any]] = []
    for block in re.split(r"\n\s*\n", text):
        block = block.strip()
        if not block:
            continue
        match = re.match(r"^(#{1,6})\s+(.*)$", block.splitlines()[0])
        if match:
            level = len(match.group(1))
            heading = heading[: level - 1] + [match.group(2).strip()]
            outline.append({"title": heading[-1], "page": None})
            rest = "\n".join(block.splitlines()[1:]).strip()
            sections.append(Section(text=heading[-1], kind="heading", heading_path=list(heading)))
            if rest:
                sections.append(Section(text=rest, heading_path=list(heading)))
            continue
        sections.append(Section(text=block, heading_path=list(heading)))
    return Parsed(sections, pages=None, outline=outline, parser="text")


# ── chunk ────────────────────────────────────────────────────────────────


def chunk(sections: list[Section]) -> list[dict[str, Any]]:
    """Grow passages from sections without crossing a page or a heading."""
    out: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    def flush() -> None:
        nonlocal current
        if current and current["text"].strip():
            out.append(current)
        current = None

    for section in sections:
        text = section.text.strip()
        if not text:
            continue
        if section.kind == "table":
            flush()
            for piece in _split_table(text):
                out.append(_passage(piece, section, kind="table"))
            continue
        same_place = (
            current is not None
            and current["page_from"] == section.page_from
            and current["heading_path"] == section.heading_path
            and len(current["text"]) + len(text) + 2 <= TARGET
        )
        if same_place:
            current["text"] += "\n\n" + text
            current["boxes"].extend(section.boxes)
            current["page_to"] = section.page_to or current["page_to"]
            continue
        flush()
        if len(text) > HARD_LIMIT:
            for piece in _split_long(text):
                out.append(_passage(piece, section))
            continue
        current = _passage(text, section)
    flush()

    for ordinal, item in enumerate(out):
        item["ordinal"] = ordinal
        item["boxes"] = item["boxes"][:40]
    return out


def _passage(text: str, section: Section, *, kind: str | None = None) -> dict[str, Any]:
    return {
        "kind": kind or ("text" if section.kind == "heading" else section.kind),
        "text": text,
        "heading_path": list(section.heading_path),
        "page_from": section.page_from,
        "page_to": section.page_to or section.page_from,
        "boxes": list(section.boxes),
    }


def _split_long(text: str) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+", text)
    pieces, current = [], ""
    for sentence in sentences:
        while len(sentence) > HARD_LIMIT:
            if current:
                pieces.append(current)
                current = ""
            pieces.append(sentence[:HARD_LIMIT])
            sentence = sentence[HARD_LIMIT:]
        if current and len(current) + len(sentence) + 1 > TARGET:
            pieces.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)
    return pieces


def _split_table(markdown: str) -> list[str]:
    lines = markdown.splitlines()
    if len(markdown) <= HARD_LIMIT or len(lines) < 4:
        return [markdown]
    head, rows = lines[:2], lines[2:]
    pieces, current = [], list(head)
    for row in rows:
        if sum(len(x) for x in current) + len(row) > TARGET and len(current) > 2:
            pieces.append("\n".join(current))
            current = list(head)
        current.append(row)
    if len(current) > 2:
        pieces.append("\n".join(current))
    return pieces


# ── embed ────────────────────────────────────────────────────────────────


def embed(texts: list[str]) -> tuple[list[list[float]] | None, str | None]:
    """Vectors for the texts, or `(None, reason)` when the model cannot give them."""
    from src.core import llm

    if not texts:
        return [], None
    client = llm.get_client()
    vectors: list[list[float]] = []
    try:
        for start in range(0, len(texts), EMBED_BATCH):
            batch = [t[:EMBED_CHARS] for t in texts[start:start + EMBED_BATCH]]
            vectors.extend(client.embed(batch))
    except llm.LlmError as exc:
        return None, exc.code
    if len(vectors) != len(texts):
        return None, "LLM_BAD_OUTPUT"
    return vectors, None


def embed_query(text: str) -> list[float] | None:
    vectors, _reason = embed([text])
    return vectors[0] if vectors else None


# ── store and run ────────────────────────────────────────────────────────


def store(session, document, parsed: Parsed, passages: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Replace a document's passages with these, embedded where possible."""
    from src.models.knowledge import KnowledgeChunk

    passages = chunk(parsed.sections) if passages is None else passages
    vectors, reason = embed([_embedding_text(p) for p in passages[:MAX_EMBEDDED]])
    warnings = list(dict.fromkeys(parsed.warnings))
    if reason:
        warnings.append(f"EMBEDDINGS_UNAVAILABLE:{reason}")
    if len(passages) > MAX_EMBEDDED and vectors:
        warnings.append(f"EMBEDDED_FIRST_{MAX_EMBEDDED}")
    if not passages:
        warnings.append("NO_TEXT_EXTRACTED")

    session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.document_id == document.id))
    for index, passage in enumerate(passages):
        vector = vectors[index] if vectors and index < len(vectors) else None
        session.add(KnowledgeChunk(
            document_id=document.id,
            collection_id=document.collection_id,
            ordinal=passage["ordinal"],
            kind=passage["kind"],
            text=passage["text"],
            heading_path=passage["heading_path"] or None,
            page_from=passage["page_from"],
            page_to=passage["page_to"],
            boxes=passage["boxes"] or None,
            embedding=vector,
            embedding_dims=len(vector) if vector else None,
        ))
    document.pages = parsed.pages
    document.parser = parsed.parser
    document.outline = parsed.outline or None
    document.warnings = warnings or None
    document.chunk_count = len(passages)
    document.embedded_count = len(vectors or [])
    session.flush()
    return {"chunks": len(passages), "embedded": document.embedded_count, "warnings": warnings}


def _embedding_text(passage: dict[str, Any]) -> str:
    """The passage with the headings it sits under, which carry its subject."""
    path = " › ".join(passage.get("heading_path") or [])
    return f"{path}\n{passage['text']}" if path else passage["text"]


def _line(message: str, level: str = "INFO") -> dict[str, Any]:
    return {"at": iso(now()), "level": level, "message": message}


def queue(session, document, *, principal=None) -> None:
    """Give a document a job and start reading it once the caller commits.

    The caller commits and then calls `start(document_id)`; spawning here would
    look for a row that is still inside this transaction.
    """
    from src.models.platform import BackgroundJob

    file = document.file
    job = BackgroundJob(
        reference=_reference(document),
        name=f"Read {file.name if file else 'document'}"[:200],
        kind=JOB_KIND,
        queue=JOB_QUEUE,
        status="QUEUED",
        priority="NORMAL",
        progress=0,
        total_units=1,
        processed_units=0,
        failed_units=0,
        attempt=1,
        max_attempts=1,
        initiated_by_id=getattr(principal, "user_id", None),
        initiated_by_label=getattr(principal, "full_name", None) or "System",
        organization_id=getattr(principal, "organization_id", None),
        payload={"document_id": str(document.id), "collection_id": str(document.collection_id)},
        log_lines=[_line(f"queued {file.name if file else ''}".strip())],
    )
    session.add(job)
    session.flush()
    document.job_id = job.id
    document.status = "QUEUED"
    document.error_code = None
    document.error_message = None
    session.flush()


def _reference(document) -> str:
    """`ING-<document>-<n>`: unique without asking the table.

    A sequence read from `MAX(reference)` raced when several files of one drop
    were added at the same moment — two requests read the same maximum and the
    second insert hit the unique index. The document id is already unique; a
    short random tail keeps each reprocess its own job.
    """
    from uuid import uuid4

    return f"ING-{document.id.hex[:12].upper()}-{uuid4().hex[:4].upper()}"


def start(document_id: Any) -> str:
    return background.spawn(lambda: run(document_id), name=f"ingest:{document_id}")


def run(document_id: Any) -> None:
    """Read one document. Owns its sessions and records every outcome."""
    from src.models.knowledge import KnowledgeDocument
    from src.models.platform import BackgroundJob

    started = now()
    with session_scope() as session:
        document = session.get(KnowledgeDocument, document_id)
        if document is None or document.status not in ("QUEUED", "FAILED", "READY"):
            return
        document.status = "PARSING"
        document.started_at = started
        job = session.get(BackgroundJob, document.job_id) if document.job_id else None
        if job is not None:
            job.status = "RUNNING"
            job.started_at = started
            job.progress = 10
            job.log_lines = [*(job.log_lines or []), _line(f"started ({background.mechanism()})")]
        file = document.file
        key, name = (file.storage_key or "", file.name) if file else ("", "")

    try:
        if not key:
            raise IngestError("FILE_MISSING", "The file this document points at is gone.")
        try:
            data = storage.for_config().get(key)
        except Exception as exc:  # noqa: BLE001 - any storage failure is the same answer here
            raise IngestError("FILE_MISSING", "The file's bytes are not in storage.") from exc
        parsed = parse(data, name)
        with session_scope() as session:
            document = session.get(KnowledgeDocument, document_id)
            document.status = "CHUNKING"
            if parsed.pages:
                document.pages = parsed.pages
        passages = chunk(parsed.sections)
        with session_scope() as session:
            document = session.get(KnowledgeDocument, document_id)
            document.status = "EMBEDDING"
            document.chunk_count = len(passages)
            job = session.get(BackgroundJob, document.job_id) if document.job_id else None
            if job is not None:
                job.progress = 50
                job.log_lines = [*(job.log_lines or []), _line(
                    f"parsed with {parsed.parser}: {len(parsed.sections)} sections"
                    + (f", {parsed.pages} pages" if parsed.pages else "")
                )]
        with session_scope() as session:
            document = session.get(KnowledgeDocument, document_id)
            outcome = store(session, document, parsed, passages)
            finished = now()
            document.status = "READY"
            document.ingested_at = finished
            job = session.get(BackgroundJob, document.job_id) if document.job_id else None
            if job is not None:
                job.status = "SUCCEEDED"
                job.progress = 100
                job.processed_units = 1
                job.finished_at = finished
                job.duration_ms = int((finished - started).total_seconds() * 1000)
                job.result = {**outcome, "ran_as": background.mechanism()}
                job.log_lines = [*(job.log_lines or []), _line(
                    f"stored {outcome['chunks']} passages, {outcome['embedded']} embedded"
                ), _line("finished")]
    except Exception as exc:  # noqa: BLE001 - the document records every outcome
        code = exc.code if isinstance(exc, IngestError) else "INGEST_FAILED"
        message = exc.message if isinstance(exc, IngestError) else f"{type(exc).__name__}: {exc}"[:500]
        with session_scope() as session:
            document = session.get(KnowledgeDocument, document_id)
            if document is None:
                return
            finished = now()
            document.status = "FAILED"
            document.error_code = code
            document.error_message = message
            job = session.get(BackgroundJob, document.job_id) if document.job_id else None
            if job is not None:
                job.status = "FAILED"
                job.finished_at = finished
                job.failed_units = 1
                job.duration_ms = int((finished - started).total_seconds() * 1000)
                job.error_message = f"{code}: {message}"[:500]
                job.log_lines = [*(job.log_lines or []), _line(f"failed: {code}", level="ERROR")]
