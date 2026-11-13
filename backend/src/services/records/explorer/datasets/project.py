"""The `project` dataset: its fields, list columns, insights and what may be written."""

from __future__ import annotations

from src.core import vocabulary
from src.core.query import Field, FieldSet
from src.models.business import Project
from src.services.records.explorer.common import common_fields as _common
from src.services.records.explorer.model import (
    Identity,
    Insight,
    Metric,
    Resource,
    Writable,
)


def declare() -> Resource:
    return Resource(
        "project", "Projects", "Portfolio delivery, budget, progress and health.", Project,
        FieldSet(
            Field("code", Project.code, searchable=True),
            Field("name", Project.name, searchable=True),
            Field("description", Project.description, searchable=True),
            Field("status", Project.status, kind="enum", facet=True,
                  choices=vocabulary.PROJECT_STATUS),
            Field("phase", Project.phase, kind="enum", facet=True,
                  choices=vocabulary.PROJECT_PHASE),
            Field("priority", Project.priority, kind="enum", facet=True,
                  choices=vocabulary.PRIORITY),
            Field("health", Project.health, kind="enum", facet=True,
                  choices=vocabulary.PROJECT_HEALTH),
            Field("start_date", Project.start_date, kind="datetime"),
            Field("due_date", Project.due_date, kind="datetime"),
            Field("completed_at", Project.completed_at, kind="datetime", label="Completed"),
            Field("budget", Project.budget, kind="number"),
            Field("spent", Project.spent, kind="number"),
            Field("currency", Project.currency, kind="enum", facet=True,
                  choices=vocabulary.CURRENCY),
            Field("progress", Project.progress, kind="number"),
            Field("owner_id", Project.owner_id, kind="uuid", label="Owner ID"),
            Field("customer_id", Project.customer_id, kind="uuid", label="Customer ID"),
            *_common(Project),
        ),
        ("code", "name", "status", "health", "priority", "progress", "due_date"),
        route="/projects", title_field="name", subtitle_field="code",
        content_fields=("description",),
        insight=Insight(
            metrics=(
                Metric("total", "Projects"),
                Metric("at_risk", "At risk", field="health", equals=("AT_RISK", "OFF_TRACK")),
                Metric("budget", "Budget", kind="sum", field="budget", format="currency"),
                Metric("spent", "Spent", kind="sum", field="spent", format="currency"),
            ),
            breakdowns=("health", "phase", "status"),
            trend="start_date",
            trend_value="budget",
        ),
        editable=(
            Writable("name", required=True),
            Writable("description"),
            Writable("status"),
            Writable("phase"),
            Writable("priority"),
            Writable("health"),
            Writable("start_date"),
            Writable("due_date"),
            Writable("budget", minimum=0),
            Writable("spent", minimum=0),
            Writable("currency"),
            Writable("progress", minimum=0, maximum=100),
            Writable("owner_id"),
            Writable("customer_id"),
        ),
        identity=Identity("code", "PRJ", width=4),
    )
