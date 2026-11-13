"""Small builders for a suggested insight: a KPI, a chart, a record list."""

from __future__ import annotations

from typing import Any


def _kpi(label: str, dataset: str, measure: Any = "count", *, fmt: str = "number", period: str | None = None,
         filters: dict[str, Any] | None = None, compare: bool = False, hint: str = "") -> dict[str, Any]:
    query: dict[str, Any] = {"dataset": dataset, "measures": [measure]}
    if period:
        query["period"] = period
    if filters:
        query["filters"] = filters
    node = {"type": "kpi", "label": label, "format": fmt, "query": query, "width": "third"}
    if compare:
        node["compare"] = True
    if hint:
        node["hint"] = hint
    return node


def _chart(kind: str, title: str, dataset: str, dimensions: list[Any], measures: list[Any] | None = None, *,
           period: str | None = None, filters: dict[str, Any] | None = None, width: str = "half",
           limit: int | None = None, fmt: str = "number") -> dict[str, Any]:
    query: dict[str, Any] = {"dataset": dataset, "dimensions": dimensions, "measures": measures or ["count"]}
    if period:
        query["period"] = period
    if filters:
        query["filters"] = filters
    if limit:
        query["limit"] = limit
    return {"type": kind, "title": title, "query": query, "width": width, "format": fmt}


def _records(kind: str, title: str, dataset: str, columns: list[str], *, sort: str, order: str = "desc",
             filters: dict[str, Any] | None = None, limit: int = 6, width: str = "full") -> dict[str, Any]:
    records: dict[str, Any] = {"dataset": dataset, "columns": columns, "sort": sort, "order": order, "limit": limit}
    if filters:
        records["filters"] = filters
    return {"type": kind, "title": title, "records": records, "width": width}
