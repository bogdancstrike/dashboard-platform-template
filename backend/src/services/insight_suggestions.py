"""Suggested insights, one set per dataset (§43).

Written by hand rather than generated: a suggestion is the first thing a
reader presses, so it has to work every time, cost nothing, and show what the
registry can do. Each is a complete spec — the same shape the model writes —
so pressing one binds it as the viewer and saves nothing until they choose to.
"""

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


SUGGESTIONS: dict[str, list[dict[str, Any]]] = {
    "order": [
        {
            "question": "How are sales trending this year?",
            "spec": {
                "title": "Sales this year",
                "summary": "Revenue and order volume over the last twelve months, by channel and by status.",
                "blocks": [
                    _kpi("Revenue · 90 days", "order", {"aggregation": "sum", "field": "total"}, fmt="currency",
                         period="last_90_days", compare=True, hint="against the 90 days before"),
                    _kpi("Orders · 90 days", "order", period="last_90_days", compare=True),
                    _kpi("Average order", "order", {"aggregation": "avg", "field": "total"}, fmt="currency",
                         period="last_90_days"),
                    _chart("area", "Revenue by month", "order", [{"field": "placed_at", "granularity": "month"}],
                           [{"aggregation": "sum", "field": "total"}], period="last_365_days", width="full",
                           fmt="currency"),
                    _chart("bar", "Revenue by channel", "order", ["channel"], [{"aggregation": "sum", "field": "total"}],
                           period="last_365_days", fmt="currency"),
                    _chart("pie", "Orders by status", "order", ["status"], period="last_365_days"),
                    _records("table", "Latest orders", "order",
                             ["reference", "status", "channel", "total", "placed_at"], sort="placed_at"),
                ],
            },
        },
        {
            "question": "Which orders are stuck before shipping?",
            "spec": {
                "title": "Orders waiting to ship",
                "blocks": [
                    {"type": "callout", "tone": "warning", "title": "What counts as stuck",
                     "text": "Orders that are pending, confirmed or processing — paid for, not yet on their way."},
                    _kpi("Waiting", "order", filters={"status": "PENDING,CONFIRMED,PROCESSING"}),
                    _kpi("Value waiting", "order", {"aggregation": "sum", "field": "total"}, fmt="currency",
                         filters={"status": "PENDING,CONFIRMED,PROCESSING"}),
                    _chart("bar", "Waiting, by status", "order", ["status"],
                           filters={"status": "PENDING,CONFIRMED,PROCESSING"}, width="third"),
                    _records("table", "Oldest first", "order", ["reference", "status", "payment_status", "total", "placed_at"],
                             sort="placed_at", order="asc", filters={"status": "PENDING,CONFIRMED,PROCESSING"}, limit=8),
                ],
            },
        },
    ],
    "ticket": [
        {
            "question": "How is support keeping up?",
            "spec": {
                "title": "Support at a glance",
                "summary": "Volume, SLA and satisfaction over the last 90 days.",
                "blocks": [
                    _kpi("New tickets · 90 days", "ticket", period="last_90_days", compare=True),
                    _kpi("SLA breached", "ticket", filters={"sla_breached": "true"}, period="last_90_days"),
                    _kpi("Satisfaction", "ticket", {"aggregation": "avg", "field": "satisfaction"}, period="last_90_days",
                         hint="average score"),
                    _chart("line", "Tickets per week", "ticket", [{"field": "created_at", "granularity": "week"}],
                           period="last_90_days", width="full"),
                    _chart("bar", "Open work by priority", "ticket", ["priority"],
                           filters={"status": "OPEN,ASSIGNED,IN_PROGRESS,WAITING_CUSTOMER,ESCALATED"}),
                    _chart("pie", "Where tickets come from", "ticket", ["channel"], period="last_90_days"),
                    _records("list", "Breached, most recent", "ticket", ["subject", "reference", "priority", "status"],
                             sort="created_at", filters={"sla_breached": "true"}),
                ],
            },
        },
    ],
    "project": [
        {
            "question": "Which projects are at risk, and how is the budget holding?",
            "spec": {
                "title": "Portfolio health",
                "blocks": [
                    _kpi("Projects", "project"),
                    _kpi("Budget", "project", {"aggregation": "sum", "field": "budget"}, fmt="currency"),
                    _kpi("Spent", "project", {"aggregation": "sum", "field": "spent"}, fmt="currency"),
                    _chart("bar", "Health", "project", ["health"], width="third"),
                    _chart("bar", "Budget and spend by status", "project", ["status"],
                           [{"aggregation": "sum", "field": "budget"}, {"aggregation": "sum", "field": "spent"}],
                           width="half", fmt="currency"),
                    _records("table", "At risk or off track", "project", ["code", "name", "health", "progress", "due_date"],
                             sort="due_date", order="asc", filters={"health": "AT_RISK,OFF_TRACK"}, limit=8),
                ],
            },
        },
    ],
    "customer": [
        {
            "question": "Who are our customers and where is the value?",
            "spec": {
                "title": "Customer base",
                "blocks": [
                    _kpi("Customers", "customer"),
                    _kpi("Lifetime value", "customer", {"aggregation": "sum", "field": "lifetime_value"}, fmt="currency"),
                    _kpi("Satisfaction", "customer", {"aggregation": "avg", "field": "satisfaction"}),
                    _chart("pie", "By segment", "customer", ["segment"]),
                    _chart("bar", "Value by industry", "customer", ["industry"],
                           [{"aggregation": "sum", "field": "lifetime_value"}], limit=8, fmt="currency"),
                    _chart("bar", "Customers by country", "customer", ["country"], limit=10, width="full"),
                    _records("table", "Most valuable", "customer", ["name", "segment", "industry", "lifetime_value"],
                             sort="lifetime_value", limit=8),
                ],
            },
        },
    ],
    "task": [
        {
            "question": "What is the team working on, and what is blocked?",
            "spec": {
                "title": "Work in flight",
                "blocks": [
                    _kpi("In progress", "task", filters={"status": "IN_PROGRESS,IN_REVIEW"}),
                    _kpi("Blocked", "task", filters={"status": "BLOCKED"}),
                    _kpi("Hours logged · 30 days", "task", {"aggregation": "sum", "field": "logged_hours"},
                         period="last_30_days", fmt="duration"),
                    _chart("bar", "By status", "task", ["status"], width="half"),
                    _chart("pie", "Open work by priority", "task", ["priority"],
                           filters={"status": "NEW,ASSIGNED,IN_PROGRESS,BLOCKED,IN_REVIEW"}),
                    _records("list", "Blocked tasks", "task", ["title", "reference", "priority", "due_date"],
                             sort="due_date", order="asc", filters={"status": "BLOCKED"}),
                ],
            },
        },
    ],
    "device": [
        {
            "question": "How healthy is the device fleet?",
            "spec": {
                "title": "Fleet health",
                "blocks": [
                    _kpi("Devices", "device"),
                    _kpi("Errors reported", "device", {"aggregation": "sum", "field": "error_count"}),
                    _kpi("Average battery", "device", {"aggregation": "avg", "field": "battery_percent"}, fmt="percent"),
                    _chart("pie", "By status", "device", ["status"]),
                    _chart("bar", "Errors by kind", "device", ["kind"], [{"aggregation": "sum", "field": "error_count"}]),
                    _records("table", "Lowest battery", "device", ["name", "kind", "status", "battery_percent", "location"],
                             sort="battery_percent", order="asc", limit=8),
                ],
            },
        },
    ],
}


def for_viewer(principal, resources: dict[str, Any]) -> list[dict[str, Any]]:
    """The suggestions whose dataset this reader may read, keyed for the page."""
    out = []
    for dataset, items in SUGGESTIONS.items():
        resource = resources.get(dataset)
        if resource is None or not principal.can(resource.permission):
            continue
        for index, item in enumerate(items):
            out.append({"key": f"{dataset}-{index + 1}", "dataset": dataset, "dataset_label": resource.label,
                        "question": item["question"], "title": item["spec"]["title"]})
    return out


def find(key: str) -> dict[str, Any] | None:
    dataset, _, number = str(key).rpartition("-")
    items = SUGGESTIONS.get(dataset) or []
    try:
        index = int(number) - 1
    except ValueError:
        return None
    return {"dataset": dataset, **items[index]} if 0 <= index < len(items) else None
