"""Panels about tasks, projects and the device fleet."""

from __future__ import annotations

from typing import Any

from src.core import vocabulary
from src.models.business import Device, Project, Task
from src.services.analytics.overview.panel_queries import _device_health
from src.services.analytics.overview.window import Window


def tasks_by_status(w: Window) -> dict[str, Any]:
    return {"kind": "bar", "title": "Tasks by status", "description": "Current task state · all dates",
            "series": w.grouped(Task.status)}


def projects_by_health(w: Window) -> dict[str, Any]:
    return {"kind": "pie", "title": "Projects by health",
            "description": "Current active projects · all dates",
            "series": w.grouped(Project.health, None, Project.status == "ACTIVE")}


def budget_vs_progress(w: Window) -> dict[str, Any]:
    # A correlation: the projects far from the diagonal are the finding.
    return {"kind": "scatter", "title": "Budget spent against work done",
            "description": "Current projects · bubble size represents budget",
            "axes": {"x": "Budget spent", "y": "Work done", "format": "percent"},
            "series": w.portfolio}


def device_health(w: Window) -> dict[str, Any]:
    return {"kind": "stacked-hbar", "title": "Fleet state by kind",
            "description": "Current fleet state · all dates",
            "groups": list(vocabulary.DEVICE_STATUS), "series": _device_health(w.session, Device)}


def portfolio_budget(w: Window) -> dict[str, Any]:
    return {"kind": "treemap", "title": "Where the project budget sits",
            "description": "Current portfolio · area represents budget; grouped by health",
            "unit": "currency", "series": w.portfolio}
