"""Organizations, departments and teams (§42): the shape of the company.
See docs/architecture/backend/organizations.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "common": (
        "VIEW_PERMISSION", "MANAGE_PERMISSION", "MAX_DEPTH", "_CODE", "_NAME", "_fields",
        "DEFAULT_COLUMNS", "_statement", "_checked_name", "_checked_code", "_slug",
        "_people_by_organization", "_people_by_department", "summarise",
    ),
    "listing_view": ("catalogue", "listing", "_counts", "_organization", "_department"),
    "org_tree": ("tree", "_depth", "_unassigned", "_people_named"),
    "changes": ("update", "_one_of", "_positive", "create_department", "_depth_of"),
    "departments": ("move_department", "_ancestry", "remove_department"),
})
