"""A page's blocks, cleaned, and the plain text they read as."""

from __future__ import annotations

import re
from typing import Any
from uuid import uuid4

from src.core.errors import ValidationError
from src.core.pagination import parse_uuid

VIEW = "docs.view"


EDIT = "docs.edit"


#: A save by the same person this soon after their last revision rewrites it.
COALESCE_MINUTES = 10


MAX_BLOCKS = 400


MAX_TEXT = 20_000


MAX_TITLE = 200


BLOCK_KINDS: tuple[str, ...] = (
    "heading", "text", "list", "checklist", "quote", "code", "callout", "image",
    "table", "divider", "chart", "report", "record", "action",
)


TONES = ("info", "success", "warning", "danger")


MEETINGS_SPACE = "meetings"


def _text(raw: Any, field: str, *, limit: int = MAX_TEXT) -> str:
    value = "" if raw is None else str(raw)
    if len(value) > limit:
        raise ValidationError(f"{field} is at most {limit} characters.", details={"field": field})
    return value


def _clean_block(raw: Any, index: int) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValidationError("Each block must be an object.", details={"block": index})
    kind = str(raw.get("kind") or "").lower()
    if kind not in BLOCK_KINDS:
        raise ValidationError(
            f"Block {index + 1} is not a kind the editor knows.",
            details={"block": index, "kind": kind, "allowed": list(BLOCK_KINDS)},
        )
    block: dict[str, Any] = {"id": str(raw.get("id") or f"b{uuid4().hex[:10]}")[:40], "kind": kind}
    where = f"block {index + 1}"
    if kind in ("heading", "text", "quote", "callout", "code"):
        block["text"] = _text(raw.get("text"), where)
    if kind == "heading":
        level = raw.get("level") or 2
        block["level"] = level if level in (1, 2, 3) else 2
    if kind == "code":
        block["language"] = _text(raw.get("language") or "", where, limit=24)
    if kind == "callout":
        tone = str(raw.get("tone") or "info")
        block["tone"] = tone if tone in TONES else "info"
    if kind == "list":
        items = raw.get("items") or []
        if not isinstance(items, list):
            raise ValidationError(f"{where}: items must be a list.", details={"block": index})
        block["items"] = [_text(item, where, limit=2000) for item in items[:200]]
        block["ordered"] = bool(raw.get("ordered"))
    if kind == "checklist":
        items = raw.get("items") or []
        if not isinstance(items, list):
            raise ValidationError(f"{where}: items must be a list.", details={"block": index})
        block["items"] = [
            {"text": _text((item or {}).get("text"), where, limit=2000), "done": bool((item or {}).get("done"))}
            for item in items[:200]
            if isinstance(item, dict)
        ]
    if kind == "table":
        rows = raw.get("rows") or []
        if not isinstance(rows, list) or not all(isinstance(row, list) for row in rows):
            raise ValidationError(f"{where}: rows must be a list of lists.", details={"block": index})
        block["rows"] = [[_text(cell, where, limit=1000) for cell in row[:12]] for row in rows[:100]]
        block["header"] = bool(raw.get("header", True))
    if kind == "image":
        block["file_id"] = str(parse_uuid(raw["file_id"], field="file_id")) if raw.get("file_id") else None
        block["caption"] = _text(raw.get("caption"), where, limit=400)
    if kind in ("chart", "report"):
        # The report builder's own block shape, kept as it arrived: the
        # analysis compiler checks the question when it is drawn.
        for key in ("entity", "dimension", "granularity", "stack", "aggregation", "measure",
                    "period", "chart", "show", "caption", "report_id"):
            if raw.get(key) not in (None, ""):
                block[key] = _text(raw.get(key), where, limit=400)
        if isinstance(raw.get("filters"), dict):
            block["filters"] = {str(k)[:64]: v for k, v in list(raw["filters"].items())[:20]}
    if kind == "record":
        block["resource_type"] = _text(raw.get("resource_type"), where, limit=48)
        block["resource_id"] = str(parse_uuid(raw.get("resource_id"), field="resource_id"))
        block["label"] = _text(raw.get("label"), where, limit=240)
    if kind == "action":
        block["text"] = _text(raw.get("text"), where, limit=500)
        block["assignee_id"] = (
            str(parse_uuid(raw["assignee_id"], field="assignee_id")) if raw.get("assignee_id") else None
        )
        due = raw.get("due_date")
        block["due_date"] = str(due)[:10] if due else None
        block["task_id"] = str(parse_uuid(raw["task_id"], field="task_id")) if raw.get("task_id") else None
        block["done"] = bool(raw.get("done"))
    return block


def clean_blocks(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValidationError("blocks must be a list.", details={"field": "blocks"})
    if len(raw) > MAX_BLOCKS:
        raise ValidationError(f"A page holds at most {MAX_BLOCKS} blocks.", details={"field": "blocks"})
    blocks = [_clean_block(item, index) for index, item in enumerate(raw)]
    seen: set[str] = set()
    for block in blocks:
        if block["id"] in seen:
            block["id"] = f"b{uuid4().hex[:10]}"
        seen.add(block["id"])
    return blocks


_MARKS = re.compile(r"[*_`#>\[\]]")


def plain_text(title: str, blocks: list[dict[str, Any]]) -> str:
    """Everything a person could search for on the page, as one string."""
    parts = [title]
    for block in blocks:
        for key in ("text", "caption", "label"):
            if block.get(key):
                parts.append(str(block[key]))
        for item in block.get("items") or []:
            parts.append(item["text"] if isinstance(item, dict) else str(item))
        for row in block.get("rows") or []:
            parts.append(" ".join(row))
    return _MARKS.sub("", "\n".join(part for part in parts if part))[:200_000]


def _title(raw: Any) -> str:
    title = _text(raw, "title", limit=MAX_TITLE).strip()
    if not title:
        raise ValidationError("A page needs a title.", details={"field": "title"})
    return title
