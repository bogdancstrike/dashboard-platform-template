"""Work planning demo data: sprints with history, epics, a timeline worth reading (§18)."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "templates": (
        "POINTS", "SEED", "EPICS", "STORIES", "BUGS", "MILESTONES", "BLOCKERS", "TEMPLATES",
        "RECURRING", "_at", "_day", "_fill_dates", "_fill_ages",
    ),
    "history": ("_Maker", "_recount", "_history"),
    "plan": ("_plan",),
    "assembly": ("populate",),
})
