"""Seed data for planning: _plan."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "work": ("_team_and_epics", "_work"),
    "sprints": ("_sprints", "_backlog_and_timeline"),
    "recurring": (
        "_watchers", "_wip_limits", "_templates", "_recurring", "PROJECT_STEPS", "FINISHING_STEPS",
        "_plan",
    ),
})
