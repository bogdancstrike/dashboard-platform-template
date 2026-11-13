"""Binding live data into a spec."""

from __future__ import annotations

import copy
from datetime import timedelta
from typing import Any

from src.core.errors import ApiError
from src.services.analytics import analysis
from src.services.analytics.insights.spec.vocabulary import MAX_INLINE_ITEMS, MAX_ROWS
from src.services.records import explorer


def bind(session, spec: dict[str, Any], *, principal) -> tuple[dict[str, Any], list[str]]:
    """The spec with every query's data inlined, read as `principal`."""
    rendered = copy.deepcopy(spec)
    errors: list[str] = []
    for node in _walk(rendered["blocks"]):
        try:
            if "query" in node:
                node["data"] = _bind_query(session, node, principal)
            elif "records" in node:
                node["data"] = _bind_records(session, node, principal)
        except (ApiError, ValueError, TypeError, KeyError) as exc:
            message = getattr(exc, "message", None) or str(exc) or type(exc).__name__
            node["error"] = str(message)[:300]
            errors.append(f"{node.get('title') or node.get('label') or node['type']}: {node['error']}")
    return rendered, errors


def _walk(blocks: list[dict[str, Any]]):
    for node in blocks:
        yield node
        if node["type"] == "section":
            yield from _walk(node.get("blocks") or [])


def _analysis_payload(query: dict[str, Any]) -> dict[str, Any]:
    payload = {"resource_type": query["dataset"], "dimensions": query.get("dimensions") or [],
               "measures": query.get("measures") or []}
    for key in ("period", "date_field", "filters", "limit"):
        if key in query:
            payload[key] = query[key]
    return payload


def _bind_query(session, node: dict[str, Any], principal) -> dict[str, Any]:
    query = node["query"]
    kind = node["type"]
    if kind in ("kpi", "progress"):
        query = {**query, "dimensions": []}
    result = analysis.run(session, _analysis_payload(query), principal=principal)
    measures = result["measures"]
    first = measures[0]["key"]
    common = {"dataset": result["resource_type"], "dataset_label": result["resource_label"],
              "path": result["path"], "description": result["description"], "matched": result["matched"]}

    if kind in ("kpi", "progress"):
        value = result["totals"].get(first)
        out = {**common, "value": value, "measure": measures[0]["label"]}
        if kind == "kpi" and node.get("compare") and result["period"]["from"] and result["period"]["to"]:
            out["previous"] = _previous(session, query, result, first, principal)
            if isinstance(out["previous"], (int, float)) and out["previous"]:
                out["delta"] = round((float(value or 0) - out["previous"]) / abs(out["previous"]) * 100, 1)
        if kind == "progress" and "max" not in node:
            out["max"] = None
        return out

    rows = result["rows"]
    if kind == "table":
        dims = result["dimensions"]
        columns = [{"key": f"d{i}", "label": d["label"]} for i, d in enumerate(dims)]
        columns += [{"key": m["key"], "label": m["label"].capitalize(), "numeric": True} for m in measures]
        table = []
        for row in rows:
            entry = {f"d{i}": label for i, label in enumerate(row["keys"])}
            entry.update(row["values"])
            table.append(entry)
        return {**common, "columns": columns, "rows": table[:50], "totals": result["totals"]}

    if kind == "comparison":
        return {**common, "items": [{"label": " · ".join(row["keys"]) or "All", "value": row["values"].get(first)}
                                    for row in rows[:12]]}

    if kind == "list":
        return {**common, "items": [{"title": " · ".join(row["keys"]), "value": row["values"].get(first)}
                                    for row in rows[:MAX_ROWS]]}

    if kind == "timeline":
        return {**common, "events": [{"date": row["keys"][0] if row["keys"] else "",
                                      "title": f"{row['values'].get(first)} {measures[0]['label']}"}
                                     for row in rows[:MAX_INLINE_ITEMS]]}

    # Charts: categories from the first dimension; series from the measures,
    # or from the second dimension when there is one.
    dims = result["dimensions"]
    categories: list[str] = []
    for row in rows:
        label = row["keys"][0] if row["keys"] else "All"
        if label not in categories:
            categories.append(label)
    if len(dims) > 1:
        names: list[str] = []
        for row in rows:
            if len(row["keys"]) > 1 and row["keys"][1] not in names:
                names.append(row["keys"][1])
        series = []
        for name in names[:8]:
            values = []
            for category in categories:
                hit = next((r for r in rows if r["keys"][:2] == [category, name]), None)
                values.append(hit["values"].get(first) if hit else 0)
            series.append({"name": name, "values": values})
    else:
        series = [{"name": m["label"].capitalize(), "values": [row["values"].get(m["key"]) for row in rows]}
                  for m in measures]
    if result.get("other") and len(dims) == 1:
        categories.append("Other")
        for item, measure in zip(series, measures, strict=False):
            item["values"].append(result["other"]["values"].get(measure["key"]))
    return {**common, "categories": categories, "series": series, "totals": result["totals"],
            "granularity": dims[0]["granularity"] if dims else ""}


def _previous(session, query: dict[str, Any], result: dict[str, Any], key: str, principal) -> Any:
    """The same number over the window just before, for a KPI's delta."""
    from datetime import datetime

    start = datetime.fromisoformat(result["period"]["from"])
    end = datetime.fromisoformat(result["period"]["to"])
    span = end - start
    payload = _analysis_payload({**query, "dimensions": []})
    payload["period"] = {"key": "previous", "from": (start - span).isoformat(),
                         "to": (start - timedelta(microseconds=1)).isoformat(),
                         "field": result["period"]["field"]}
    previous = analysis.run(session, payload, principal=principal)
    return previous["totals"].get(key)


def _bind_records(session, node: dict[str, Any], principal) -> dict[str, Any]:
    records = node["records"]
    resource = explorer.resource_for(records["dataset"], principal=principal)
    columns = records.get("columns") or list(resource.default_columns)[:5]
    payload = {"resource_type": resource.key, "columns": columns, "filters": records.get("filters") or {},
               "page": 1, "page_size": records.get("limit", 8),
               "sort": records.get("sort") or resource.default_sort, "order": records.get("order", "desc")}
    result = explorer.run(session, payload, principal=principal)
    labels = {f["name"]: f.get("label") or f["name"] for f in result["fields"]}
    common = {"dataset": resource.key, "dataset_label": resource.label, "path": resource.path,
              "matched": result["total"]}
    items = result["items"]
    if node["type"] == "table":
        return {**common, "columns": [{"key": c, "label": labels.get(c, c)} for c in result["columns"]],
                "rows": [{**row, "href": f"{resource.path}/{row['id']}"} for row in items]}
    if node["type"] == "timeline":
        date_field = records.get("date_field") or records.get("sort") or resource.default_sort
        return {**common, "events": [{"date": str(row.get(date_field) or "")[:10],
                                      "title": str(row.get(resource.title_field) or row.get("reference") or ""),
                                      "text": str(row.get(resource.status_field) or ""),
                                      "href": f"{resource.path}/{row['id']}"} for row in items]}
    return {**common, "items": [{"title": str(row.get(resource.title_field) or row.get("id")),
                                 "subtitle": " · ".join(str(row.get(c)) for c in columns
                                                        if c not in (resource.title_field, "id") and row.get(c) not in (None, ""))[:200],
                                 "status": row.get(resource.status_field),
                                 "href": f"{resource.path}/{row['id']}"} for row in items]}
