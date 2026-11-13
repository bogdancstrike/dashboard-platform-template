"""The UI spec an insight is drawn from, and the data bound into it (§43).

An insight is a small page composed **only** from a fixed registry of general
components — a KPI tile, bar / line / area / pie charts, a table, a list,
Markdown text, a callout, a progress bar, a comparison and a timeline, plus a
section that groups them. The model (or a suggestion written by hand) chooses
and arranges them; it never writes markup or code, and it never puts numbers
in a chart itself.

Three steps, each its own function, because each has its own failure:

* **validate** — drop every node whose type is not in the registry, clamp
  every string, keep only the props a component reads. A bad node is removed
  and named in `warnings`; it never fails the insight.
* **bind** — a node that shows data carries a *query*, not data: an analysis
  (`services/analysis.run`: group, measure, period, filters) or a records
  query (`services/explorer.run`: columns, sort, filters). Each is executed as
  the *viewer*, with the viewer's permissions, read-only, and the result is
  inlined as `data`. A query that fails becomes that node's `error`, not the
  page's.
* **refresh** is binding again: the stored spec keeps its queries, so the
  numbers are re-read without asking the model anything.

The frontend renders the bound spec with the same registry and skips anything
it does not know — the contract is the same on both sides of the wire.
"""

from __future__ import annotations

import copy
from datetime import timedelta
from typing import Any

from src.core.errors import ApiError
from src.services.analytics import analysis
from src.services.records import explorer

SPEC_VERSION = 1

#: Every component an insight may use, with the props each one reads.
REGISTRY: dict[str, dict[str, str]] = {
    "kpi": {"label": "text", "value": "scalar", "format": "format", "hint": "text", "compare": "bool"},
    "bar": {"title": "text", "stacked": "bool", "horizontal": "bool", "format": "format"},
    "line": {"title": "text", "format": "format"},
    "area": {"title": "text", "stacked": "bool", "format": "format"},
    "pie": {"title": "text", "format": "format"},
    "table": {"title": "text"},
    "list": {"title": "text"},
    "markdown": {"text": "long"},
    "callout": {"tone": "tone", "title": "text", "text": "long"},
    "progress": {"label": "text", "value": "scalar", "max": "scalar", "format": "format", "hint": "text"},
    "comparison": {"title": "text", "format": "format"},
    "timeline": {"title": "text"},
    "section": {"title": "text"},
}
CHARTS = frozenset({"bar", "line", "area", "pie"})
#: Nodes whose data comes from a query rather than from the spec itself.
QUERIED = frozenset({"kpi", "progress", "table", "list", "comparison", "timeline"} | CHARTS)
WIDTHS = ("full", "half", "third")
FORMATS = ("number", "currency", "percent", "duration", "text")
TONES = ("info", "success", "warning", "danger")

MAX_NODES = 24
MAX_DEPTH = 2
MAX_TEXT = 200
MAX_LONG = 4000
MAX_ROWS = 20
MAX_INLINE_ITEMS = 50


class SpecError(Exception):
    """A spec that cannot be used at all (not a dict, no blocks)."""


# ── validate ─────────────────────────────────────────────────────────────


def validate(raw: Any) -> tuple[dict[str, Any], list[str]]:
    """A clean spec and what was dropped from it. Raises SpecError only when
    there is nothing usable."""
    if not isinstance(raw, dict):
        raise SpecError("The insight is not an object.")
    warnings: list[str] = []
    counter = {"nodes": 0}
    blocks = _nodes(raw.get("blocks"), warnings, counter, depth=1)
    if not blocks:
        raise SpecError("The insight has no components the registry knows.")
    spec = {
        "version": SPEC_VERSION,
        "title": _text(raw.get("title"), MAX_TEXT) or "Insight",
        "summary": _text(raw.get("summary"), 600),
        "blocks": blocks,
    }
    return spec, warnings


def _nodes(raw: Any, warnings: list[str], counter: dict[str, int], *, depth: int) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out = []
    for index, item in enumerate(raw):
        if counter["nodes"] >= MAX_NODES:
            warnings.append(f"Only the first {MAX_NODES} components were kept.")
            break
        node = _node(item, warnings, counter, depth=depth, where=f"block {index + 1}")
        if node is not None:
            out.append(node)
    return out


def _node(item: Any, warnings: list[str], counter: dict[str, int], *, depth: int, where: str) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        warnings.append(f"{where}: not a component, skipped.")
        return None
    kind = str(item.get("type") or "").strip().lower()
    if kind not in REGISTRY:
        warnings.append(f"{where}: unknown component {kind or '(none)'!r}, skipped.")
        return None
    if kind == "section" and depth >= MAX_DEPTH:
        warnings.append(f"{where}: sections do not nest, skipped.")
        return None
    counter["nodes"] += 1
    node: dict[str, Any] = {"type": kind, "width": item.get("width") if item.get("width") in WIDTHS else _width(kind)}
    for prop, shape in REGISTRY[kind].items():
        value = _prop(item.get(prop), shape)
        if value is not None:
            node[prop] = value
    if kind == "section":
        node["blocks"] = _nodes(item.get("blocks"), warnings, counter, depth=depth + 1)
        return node if node["blocks"] else None
    if kind in QUERIED:
        query = _query(item.get("query"))
        records = _records(item.get("records"))
        if query:
            node["query"] = query
        elif records and kind in ("table", "list", "timeline"):
            node["records"] = records
        inline = _inline(kind, item)
        if inline is not None:
            node["data"] = inline
        if not (query or node.get("records") or inline is not None or (kind in ("kpi", "progress") and "value" in node)):
            warnings.append(f"{where}: a {kind} with no data or query, skipped.")
            counter["nodes"] -= 1
            return None
    if kind in ("markdown",) and not node.get("text"):
        counter["nodes"] -= 1
        return None
    return node


def _width(kind: str) -> str:
    return {"kpi": "third", "progress": "third", "pie": "half", "callout": "full"}.get(kind, "full" if kind in ("table", "markdown", "section") else "half")


def _text(value: Any, limit: int) -> str:
    return str(value).strip()[:limit] if isinstance(value, (str, int, float)) and not isinstance(value, bool) else ""


def _prop(value: Any, shape: str) -> Any:
    if value is None:
        return None
    if shape == "text":
        return _text(value, MAX_TEXT) or None
    if shape == "long":
        return _text(value, MAX_LONG) or None
    if shape == "bool":
        return bool(value) if isinstance(value, bool) else None
    if shape == "format":
        return value if value in FORMATS else None
    if shape == "tone":
        return value if value in TONES else "info"
    if shape == "scalar":
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return value
        return _text(value, 40) or None
    return None  # pragma: no cover - every shape is listed above


def _query(raw: Any) -> dict[str, Any] | None:
    """An analysis question, kept to the keys `analysis.run` reads."""
    if not isinstance(raw, dict) or not raw.get("dataset"):
        return None
    out: dict[str, Any] = {"dataset": _text(raw.get("dataset"), 40)}
    dimensions = raw.get("dimensions") or []
    if isinstance(dimensions, (str, dict)):
        dimensions = [dimensions]
    if isinstance(dimensions, list):
        out["dimensions"] = [d if isinstance(d, dict) else str(d) for d in dimensions[:2]]
    measures = raw.get("measures") or []
    if isinstance(measures, (str, dict)):
        measures = [measures]
    if isinstance(measures, list):
        out["measures"] = [m if isinstance(m, dict) else str(m) for m in measures[:4]]
    for key in ("period", "date_field"):
        if isinstance(raw.get(key), (str, dict)):
            out[key] = raw[key]
    if isinstance(raw.get("filters"), dict):
        out["filters"] = {str(k)[:60]: v for k, v in list(raw["filters"].items())[:12]}
    if isinstance(raw.get("limit"), int) and not isinstance(raw.get("limit"), bool):
        out["limit"] = max(1, min(int(raw["limit"]), 50))
    return out


def _records(raw: Any) -> dict[str, Any] | None:
    """A records question, kept to the keys `explorer.run` reads."""
    if not isinstance(raw, dict) or not raw.get("dataset"):
        return None
    out: dict[str, Any] = {"dataset": _text(raw.get("dataset"), 40)}
    if isinstance(raw.get("columns"), list):
        out["columns"] = [str(c)[:60] for c in raw["columns"][:8]]
    if isinstance(raw.get("filters"), dict):
        out["filters"] = {str(k)[:60]: v for k, v in list(raw["filters"].items())[:12]}
    for key in ("sort", "date_field"):
        if isinstance(raw.get(key), str):
            out[key] = raw[key][:60]
    out["order"] = "asc" if raw.get("order") == "asc" else "desc"
    limit = raw.get("limit")
    out["limit"] = max(1, min(int(limit), MAX_ROWS)) if isinstance(limit, int) and not isinstance(limit, bool) else 8
    return out


def _inline(kind: str, item: dict[str, Any]) -> Any:
    """Data the spec states itself — only for shapes a model may write by hand."""
    data = item.get("data")
    if kind == "comparison" and isinstance(item.get("items"), list):
        data = {"items": item["items"]}
    if kind == "timeline" and isinstance(item.get("events"), list):
        data = {"events": item["events"]}
    if kind == "list" and isinstance(item.get("items"), list):
        data = {"items": item["items"]}
    if not isinstance(data, dict):
        return None
    if kind == "comparison" and isinstance(data.get("items"), list):
        return {"items": [{"label": _text(i.get("label"), MAX_TEXT), "value": _prop(i.get("value"), "scalar")}
                          for i in data["items"][:12] if isinstance(i, dict)]}
    if kind == "timeline" and isinstance(data.get("events"), list):
        return {"events": [{"date": _text(e.get("date"), 40), "title": _text(e.get("title"), MAX_TEXT),
                            "text": _text(e.get("text"), 400), "tone": e.get("tone") if e.get("tone") in TONES else None}
                           for e in data["events"][:MAX_INLINE_ITEMS] if isinstance(e, dict)]}
    if kind == "list" and isinstance(data.get("items"), list):
        return {"items": [{"title": _text(i.get("title"), MAX_TEXT), "subtitle": _text(i.get("subtitle"), MAX_TEXT),
                           "value": _prop(i.get("value"), "scalar")}
                          for i in data["items"][:MAX_INLINE_ITEMS] if isinstance(i, dict)]}
    return None


# ── bind ─────────────────────────────────────────────────────────────────


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


def queries_of(spec: dict[str, Any]) -> list[str]:
    """The datasets an insight reads — what a viewer needs permission for."""
    out = []
    for node in _walk(spec.get("blocks") or []):
        for key in ("query", "records"):
            if key in node and node[key]["dataset"] not in out:
                out.append(node[key]["dataset"])
    return out
