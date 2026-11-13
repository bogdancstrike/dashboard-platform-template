"""Report and chart blocks, resolved to the numbers they show."""

from __future__ import annotations

from typing import Any

from src.core import documents
from src.services.analytics import analysis, reports


def _resolve_report(
    session, block: dict[str, Any], *, principal, image: Any, orientation: str
) -> list[dict[str, Any]]:
    """A saved report, drawn as its own definition says and as it was previewed."""
    report_id = str(block.get("report_id") or "")
    caption = str(block.get("caption") or "")
    if not report_id:
        return [{"kind": "NOTE", "text": "A report block with no report chosen."}]

    try:
        answer = reports.run(session, report_id, {}, principal=principal)
    except Exception as error:  # noqa: BLE001 — every failure is one sentence
        return [{"kind": "NOTE", "text": _why("report", error)}]

    name = answer["report"]["name"]
    result = answer["result"]
    show = str(block.get("show") or "both")
    pieces: list[dict[str, Any]] = []

    png = documents.decode_png(image)
    if show in {"chart", "both"} and png:
        pieces.append({"kind": "IMAGE", "png": png, "caption": caption or name})
    if show in {"table", "both"} or (show == "chart" and not png):
        columns, rows = _tabulate(result)
        if rows:
            fitted, cut, dropped = documents.fit_columns(columns, rows, orientation)
            pieces.append({
                "kind": "TABLE",
                "caption": caption or name,
                "columns": fitted,
                "rows": cut,
                "note": f"{dropped} more columns are in the report itself." if dropped else "",
            })
        else:
            pieces.append({"kind": "NOTE", "text": f"{name} matched nothing."})

    if show == "chart" and not png and pieces:
        pieces.insert(0, {
            "kind": "NOTE",
            "text": "The chart could not be captured, so its numbers are below.",
        })
    return pieces or [{"kind": "NOTE", "text": f"{name} produced nothing to show."}]


def _resolve_chart(
    session, block: dict[str, Any], *, principal, image: Any, orientation: str
) -> list[dict[str, Any]]:
    """A chart the block composed itself, through the one analysis compiler.

    Identical in shape to `_resolve_report` and deliberately so: the only
    difference between the two is where the question came from. A saved report
    is a question somebody kept; this is one they asked here — and both are
    answered by `analysis.run`, so a document cannot disagree with the chart
    builder about what the same grouping means.
    """
    entity = str(block.get("entity") or "")
    caption = str(block.get("caption") or "")
    if not entity:
        return [{"kind": "NOTE", "text": "A chart block with no dataset chosen."}]

    request = {
        "resource_type": entity,
        "dimensions": [
            {
                "field": str(block.get("dimension") or ""),
                "granularity": str(block.get("granularity") or ""),
            }
        ],
        "measures": [_measure_of(block)],
        "filters": block.get("filters") or {},
        "period": block.get("period") or "",
    }
    if block.get("stack"):
        request["dimensions"].append({"field": str(block["stack"]), "granularity": ""})

    try:
        result = analysis.run(session, request, principal=principal)
    except Exception as error:  # noqa: BLE001 — every failure is one sentence
        return [{"kind": "NOTE", "text": _why("chart", error)}]

    show = str(block.get("show") or "chart")
    pieces: list[dict[str, Any]] = []
    # A block asking for the numbers alone does not get a picture even when the
    # browser captured one — otherwise the file disagrees with the preview.
    png = documents.decode_png(image) if show != "table" else None
    if png:
        pieces.append({"kind": "IMAGE", "png": png, "caption": caption})

    # The numbers, when the picture could not be captured — and when the block
    # asked for both. The same honest degradation a report block makes: the
    # numbers are the point and the picture was the presentation of them.
    if show in ("both", "table") or not png:
        columns, rows = _tabulate(result)
        if rows:
            fitted, cut, dropped = documents.fit_columns(columns, rows, orientation)
            pieces.append({
                "kind": "TABLE",
                "caption": caption,
                "columns": fitted,
                "rows": cut,
                "note": f"{dropped} more columns in the full result." if dropped else "",
            })

    if not pieces:
        return [{"kind": "NOTE", "text": "This chart matched nothing."}]
    if not png and show == "chart":
        pieces.insert(0, {
            "kind": "NOTE",
            "text": "The chart could not be captured, so its numbers are below.",
        })
    return pieces


def _measure_of(block: dict[str, Any]) -> dict[str, Any]:
    """What a chart block counts, or sums, or averages.

    Counting rows is the default because it is the only measure every dataset
    can answer — a block that defaulted to summing would need a numeric column
    chosen before it could draw anything at all.
    """
    aggregation = str(block.get("aggregation") or "count")
    field = str(block.get("measure") or "")
    if aggregation == "count" or not field:
        return {"aggregation": "count"}
    return {"aggregation": aggregation, "field": field}


def _tabulate(result: dict[str, Any]) -> tuple[list[str], list[list[str]]]:
    """An analysis result as a table — the grouping, then each measure."""
    dimensions = result.get("dimensions") or []
    measures = result.get("measures") or []
    columns = [str(item.get("label") or item.get("key") or "Group") for item in dimensions]
    columns += [str(item.get("label") or item.get("key") or "Value") for item in measures]

    rows: list[list[str]] = []
    for entry in result.get("rows") or []:
        keys = [str(value) for value in (entry.get("keys") or [])]
        values = [_number(entry.get("values", {}).get(item.get("key"))) for item in measures]
        rows.append(keys + values)
    return columns, rows


def _number(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "" if value is None else str(value)
    return f"{number:,.0f}" if number == int(number) else f"{number:,.2f}"


def _why(what: str, error: Exception) -> str:
    """Why one block is a sentence instead of a table.

    Named rather than generic: a document with "could not be rendered" in it
    sends somebody to a developer, and "your role does not include orders" is
    something they can act on themselves (§34, §76).
    """
    message = str(getattr(error, "message", "") or error) or f"this {what} could not be read"
    return f"[{message}]"
