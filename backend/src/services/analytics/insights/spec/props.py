"""None"""

from __future__ import annotations

from typing import Any

from src.services.analytics.insights.spec.vocabulary import (
    FORMATS,
    MAX_INLINE_ITEMS,
    MAX_LONG,
    MAX_ROWS,
    MAX_TEXT,
    TONES,
)


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
