"""What the explorer offers: every dataset the reader may open."""

from __future__ import annotations

from typing import Any

from src.core.query import count_of
from src.services.records.explorer.querying import _base_statement
from src.services.records.explorer.registry import resources


def catalogue(session, *, principal) -> dict[str, Any]:
    """Describe every dataset the caller may explore, including live counts."""
    items = []
    for resource in resources().values():
        if not principal.can(resource.permission):
            continue
        base = _base_statement(resource)
        items.append({
            "key": resource.key,
            "label": resource.label,
            "description": resource.description,
            "permission": resource.permission,
            "path": resource.path,
            "title_field": resource.title_field,
            "subtitle_field": resource.subtitle_field,
            "status_field": resource.status_field,
            "record_count": count_of(session, base),
            "default_columns": list(resource.default_columns),
            "default_sort": resource.default_sort,
            "fields": [
                {**described, **resource.writability(described["name"])}
                for described in resource.fields.describe()
            ],
            # A create form has no record to read this from, so the catalogue
            # carries it (§9, §76).
            "can_create": bool(resource.identity) and principal.can("records.create"),
            "can_edit": bool(resource.editable) and principal.can("records.update"),
            "can_delete": principal.can("records.delete"),
        })
    return {"items": items, "view_modes": ["table", "list", "cards", "compact"]}
