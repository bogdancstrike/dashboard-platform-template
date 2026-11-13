"""Composition root: the modules that plug into other modules' extension points.

A lower module announces through a `core.events.Hook` or a registry
(`approvals.register`, `analytics_jobs.runner`); the features listed here
connect to it when imported. `src/services/__init__.py` imports this module,
so every process that touches a service — the API, the seed, a test — gets
the same wiring without remembering to ask for it.
"""

from __future__ import annotations

# Imported for their registrations; each line says what it connects.
from src.services.analytics.metric_watches import evaluation  # noqa: F401 - the hourly anomaly-watch job
from src.services.automation.graph import (
    triggers,  # noqa: F401 - runs workflows on record writes
    waits,  # noqa: F401 - workflow approvals resume the walk
)
from src.services.collaboration import chat  # noqa: F401 - the chat badge on the notification poll
from src.services.decisions import (  # noqa: F401
    approval_kinds,  # approval kinds access/change/report; holds record edits for approval
    approvals,  # the approvals badge on the notification poll
)
from src.services.decisions.sla import ticket_hooks  # noqa: F401 - a ticket's SLA clock on record writes
from src.services.decisions.timekeeping import timesheets  # noqa: F401 - timesheet approvals
from src.services.records.customer_health import recompute_job  # noqa: F401 - the daily health-score job
