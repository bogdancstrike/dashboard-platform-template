"""Splitting parsed sections into passages."""

from __future__ import annotations

import re
from typing import Any

from src.services.knowledge.ingest.model import HARD_LIMIT, TARGET, Section


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
