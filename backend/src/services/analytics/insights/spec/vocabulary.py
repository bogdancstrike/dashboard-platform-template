"""The insight spec vocabulary and limits."""

from __future__ import annotations

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
