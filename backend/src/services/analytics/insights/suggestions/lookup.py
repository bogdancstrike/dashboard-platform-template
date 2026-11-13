"""The suggestions a viewer may see, and finding one."""

from __future__ import annotations

from typing import Any

from src.services.analytics.insights.suggestions.catalogue import SUGGESTIONS


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
