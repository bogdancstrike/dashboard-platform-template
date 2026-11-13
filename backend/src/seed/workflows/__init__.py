"""Workflow graphs for the canvas (§49): realistic, branching, with a run history."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "workflows": ("_tree", "_n", "_e", "OWNER", "WORKFLOWS"),
    "population": ("populate", "_history"),
})
