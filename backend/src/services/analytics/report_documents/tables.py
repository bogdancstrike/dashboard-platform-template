"""Table and metric blocks, resolved to rows and figures."""

from __future__ import annotations

from typing import Any

from src.core import documents
from src.services.analytics.report_documents.charts import _why
from src.services.analytics.report_documents.vocabulary import (
    DEFAULT_TABLE_ROWS,
    MAX_TABLE_ROWS,
)
from src.services.records import explorer


def _resolve_table(session, block: dict[str, Any], *, principal, orientation: str) -> dict[str, Any]:
    """Rows of a dataset, through the query every list in the product uses."""
    entity = str(block.get("entity") or "")
    if not entity:
        return {"kind": "NOTE", "text": "A table block with no dataset chosen."}

    limit = min(MAX_TABLE_ROWS, max(1, int(block.get("limit") or DEFAULT_TABLE_ROWS)))
    request = {
        "resource_type": entity,
        "filters": block.get("filters") or {},
        "columns": block.get("columns") or None,
        "sort": block.get("sort") or "",
        "order": block.get("order") or "desc",
        "page": 1,
        "page_size": limit,
    }
    try:
        answer = explorer.run(session, request, principal=principal)
    except Exception as error:  # noqa: BLE001
        return {"kind": "NOTE", "text": _why("dataset", error)}

    fields = {field["name"]: field["label"] for field in answer.get("fields", [])}
    columns = list(answer.get("columns") or [])
    rows = [[_cell(item.get(column)) for column in columns] for item in answer.get("items", [])]
    if not rows:
        return {"kind": "NOTE", "text": f"Nothing in {entity} matched this block."}

    labels = [fields.get(column, column) for column in columns]
    fitted, cut, dropped = documents.fit_columns(labels, rows, orientation)
    total = int(answer.get("total") or 0)
    notes = []
    if dropped:
        notes.append(f"{dropped} more columns")
    if total > len(rows):
        notes.append(f"{len(rows)} of {total:,} rows")
    return {
        "kind": "TABLE",
        "caption": str(block.get("caption") or ""),
        "columns": fitted,
        "rows": cut,
        "note": " · ".join(notes),
    }


def _resolve_metrics(session, block: dict[str, Any], *, principal) -> dict[str, Any]:
    """A dataset's declared headline numbers, as a strip."""
    entity = str(block.get("entity") or "")
    if not entity:
        return {"kind": "NOTE", "text": "A metrics block with no dataset chosen."}
    try:
        answer = explorer.insights(
            session,
            {"resource_type": entity, "filters": block.get("filters") or {}},
            principal=principal,
        )
    except Exception as error:  # noqa: BLE001
        return {"kind": "NOTE", "text": _why("dataset", error)}

    wanted = [str(key) for key in (block.get("metrics") or [])]
    metrics = answer.get("metrics") or []
    if wanted:
        metrics = [metric for metric in metrics if metric.get("key") in wanted]
    # Four across a portrait page; more and each tile is a column of digits.
    metrics = metrics[:4]
    if not metrics:
        return {"kind": "NOTE", "text": f"{entity} declares no headline numbers."}
    return {
        "kind": "METRICS",
        "caption": str(block.get("caption") or ""),
        "items": [
            {"label": str(metric.get("label") or ""), "value": _metric(metric)}
            for metric in metrics
        ],
    }


def _metric(metric: dict[str, Any]) -> str:
    """A declared metric, written the way its own format says."""
    value = metric.get("value")
    fmt = str(metric.get("format") or "number")
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if fmt == "percent":
        return f"{number:,.1f}%"
    if fmt == "currency":
        return f"{number:,.0f}"
    if fmt in {"hours", "minutes"}:
        return f"{number:,.1f}"
    return f"{number:,.0f}" if number == int(number) else f"{number:,.2f}"


def _cell(value: Any) -> str:
    """One cell, as text. A JSON column is a shape, not a sentence."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (list, dict)):
        return ", ".join(str(item) for item in value) if isinstance(value, list) else "…"
    return str(value)
