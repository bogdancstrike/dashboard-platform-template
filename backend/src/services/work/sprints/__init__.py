"""Sprints: a backlog, time boxes drawn from it, and how they went (§18).
See docs/architecture/backend/sprints.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "metrics": (
        "READ", "MANAGE", "STATES", "CLOSED", "DEFAULT_LENGTH_DAYS", "STEP", "_MIN_GAP",
        "BACKLOG_LIMIT", "_points", "_sprint", "_scope", "stats", "summary", "card",
    ),
    "reading": ("listing", "detail", "backlog", "burndown", "velocity"),
    "writing": (
        "_body", "_capacity", "create", "_check_window", "update", "remove", "start", "snapshot",
        "_audit",
    ),
    "completion": ("complete", "_next_name", "snapshot_active"),
    "ranking": ("place", "_neighbour", "_rank"),
})
