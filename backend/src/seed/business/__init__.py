"""Customers, projects, tasks, tickets, orders, devices and the calendar."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "tickets": ("_customers", "_tickets"),
    "calendar": ("_projects", "_calendar"),
    "tasks": ("_tasks", "_cover_every_task_status", "_roll_up_task_counts"),
    "assembly": ("build", "_orders", "_devices"),
})
