"""Graph analysis over an in-memory edge list (§50).
See docs/architecture/backend/graph.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "clustering": (
        "MAX_ROUNDS", "adjacency", "communities", "_one_level", "_collapse",
        "_named_after_smallest_member",
    ),
    "measures": ("degrees", "modularity", "bridges"),
})
