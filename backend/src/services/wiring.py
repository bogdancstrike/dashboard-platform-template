"""Composition root: the modules that plug into other modules' extension points.

A lower module announces through a `core.events.Hook` or a registry
(`approvals.register`, `analytics_jobs.runner`); the features listed here
connect to it when imported. `src/services/__init__.py` imports this module,
so every process that touches a service — the API, the seed, a test — gets
the same wiring without remembering to ask for it.
"""

from __future__ import annotations

from src.services import (  # noqa: F401 - imported for their registrations
    approval_kinds,  # approval kinds: access, change, report; holds record edits
    approvals,  # the approvals badge on the notification poll
    automation_graph,  # workflow approvals; runs workflows on record writes
    chat,  # the chat badge on the notification poll
    customer_health,  # the daily health-score job
    metric_watches,  # the hourly anomaly-watch job
    sla,  # a ticket's SLA clock on record writes
    timekeeping,  # timesheet approvals
)
