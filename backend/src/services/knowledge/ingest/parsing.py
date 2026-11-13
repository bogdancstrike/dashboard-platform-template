"""Parsing a file: docling for documents, plain text otherwise."""

from __future__ import annotations

import json
import re
from typing import Any, Callable

import requests

from src.config import Config
from src.core import storage
from src.services.knowledge.ingest.model import (
    DOCLING_EXTENSIONS,
    TEXT_EXTENSIONS,
    IngestError,
    Parsed,
    Section,
)

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
