"""A document's payload checked: page settings and blocks."""

from __future__ import annotations

from typing import Any

from src.core import documents, sharing
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.models.personal import ReportDocument
from src.services.analytics.report_documents.page_settings import _page
from src.services.analytics.report_documents.vocabulary import (
    BLOCK_KINDS,
    CHART_KINDS,
    DEFAULT_TABLE_ROWS,
    MAX_BLOCKS,
    MAX_TABLE_ROWS,
    SHARE_PERMISSION,
    SHOW_MODES,
)
from src.services.records import explorer


def _validated(
    payload: dict[str, Any], *, principal, partial: bool, existing: ReportDocument | None = None
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("The document must be a JSON object.")

    out: dict[str, Any] = {}

    if not partial or "name" in payload:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValidationError("A document needs a name people will recognise.")
        out["name"] = name[:200]

    if "description" in payload:
        description = payload.get("description")
        out["description"] = str(description).strip()[:2000] if description else None

    if not partial or "scope" in payload:
        out["scope"] = sharing.scope_of(
            payload.get("scope"),
            current=existing.scope if existing else "PRIVATE",
            principal=principal,
            share_permission=SHARE_PERMISSION,
        )

    if "page" in payload:
        out["page"] = _page(payload.get("page"))

    if "blocks" in payload:
        out["blocks"] = _blocks(payload.get("blocks"), principal=principal)

    if not partial or "member_ids" in payload:
        out["member_ids"] = sharing.requested_members(payload)

    return out


def _blocks(raw: Any, *, principal) -> list[dict[str, Any]]:
    """The body, checked block by block.

    Shallow beyond the kind and the references, deliberately: a `TABLE` block's
    filters are executed by the explorer, which validates them properly, and
    re-deriving what a dataset may be filtered by here would be a second copy
    of the field catalogue.
    """
    if not isinstance(raw, list):
        raise ValidationError("blocks must be a list.")
    if len(raw) > MAX_BLOCKS:
        raise ValidationError(
            f"A document holds at most {MAX_BLOCKS} blocks.",
            details={"asked_for": len(raw)},
        )

    out: list[dict[str, Any]] = []
    for index, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise ValidationError("Each block must be an object.")
        kind = str(entry.get("kind") or "").strip().upper()
        if kind not in BLOCK_KINDS:
            raise ValidationError(
                "That is not a block this platform can render.",
                details={"kind": kind, "allowed": sorted(BLOCK_KINDS)},
            )

        block: dict[str, Any] = {"id": str(entry.get("id") or f"b{index + 1}")[:48], "kind": kind}

        if kind == "HEADING":
            block["text"] = str(entry.get("text") or "")[:200]
            level = int(entry.get("level") or 2)
            block["level"] = level if level in (1, 2, 3) else 2
        elif kind == "TEXT":
            block["text"] = str(entry.get("text") or "")[:8000]
        elif kind == "SPACER":
            size = str(entry.get("size") or "medium")
            block["size"] = size if size in documents.SPACER_POINTS else "medium"
        elif kind == "REPORT":
            reference = str(entry.get("report_id") or "").strip()
            if reference:
                # Parsed, not resolved: whether the reader may *see* that report
                # is decided when the document is rendered, by the endpoint that
                # owns it. A check here goes stale the moment its owner changes
                # the audience.
                block["report_id"] = str(parse_uuid(reference, field="report_id"))
            show = str(entry.get("show") or "both")
            block["show"] = show if show in SHOW_MODES else "both"
            block["caption"] = str(entry.get("caption") or "")[:200]
        elif kind == "CHART":
            entity = str(entry.get("entity") or "").strip()
            if entity:
                explorer.resource_for(entity, principal=principal)
                block["entity"] = entity
            chart = str(entry.get("chart") or "bar")
            block["chart"] = chart if chart in CHART_KINDS else "bar"
            for key in ("dimension", "granularity", "stack", "measure", "period"):
                value = str(entry.get(key) or "").strip()[:64]
                if value:
                    block[key] = value
            aggregation = str(entry.get("aggregation") or "count").strip()
            block["aggregation"] = aggregation[:16] or "count"
            show = str(entry.get("show") or "chart")
            block["show"] = show if show in SHOW_MODES else "chart"
            filters = entry.get("filters")
            if filters is not None and not isinstance(filters, dict):
                raise ValidationError("A chart block's filters must be an object.")
            block["filters"] = filters or {}
            block["caption"] = str(entry.get("caption") or "")[:200]
        elif kind == "TABLE":
            entity = str(entry.get("entity") or "").strip()
            if entity:
                explorer.resource_for(entity, principal=principal)
                block["entity"] = entity
            columns = entry.get("columns")
            if isinstance(columns, list):
                block["columns"] = [str(column)[:64] for column in columns][:12]
            filters = entry.get("filters")
            if filters is not None and not isinstance(filters, dict):
                raise ValidationError("A table block's filters must be an object.")
            block["filters"] = filters or {}
            block["sort"] = str(entry.get("sort") or "")[:64]
            block["order"] = "asc" if str(entry.get("order")) == "asc" else "desc"
            block["limit"] = min(
                MAX_TABLE_ROWS, max(1, int(entry.get("limit") or DEFAULT_TABLE_ROWS))
            )
            block["caption"] = str(entry.get("caption") or "")[:200]
        elif kind == "METRICS":
            entity = str(entry.get("entity") or "").strip()
            if entity:
                explorer.resource_for(entity, principal=principal)
                block["entity"] = entity
            metrics = entry.get("metrics")
            if isinstance(metrics, list):
                block["metrics"] = [str(key)[:64] for key in metrics][:6]
            filters = entry.get("filters")
            if filters is not None and not isinstance(filters, dict):
                raise ValidationError("A metrics block's filters must be an object.")
            block["filters"] = filters or {}
            block["caption"] = str(entry.get("caption") or "")[:200]

        out.append(block)
    return out
