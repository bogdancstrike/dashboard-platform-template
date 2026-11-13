"""The `task` dataset: its fields, list columns, insights and what may be written."""

from __future__ import annotations

from src.core import vocabulary
from src.core.query import Field, FieldSet
from src.models.business import Task
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
        "task", "Tasks", "Work items, ownership, priority and delivery state.", Task,
        FieldSet(
            Field("reference", Task.reference, searchable=True, label="Reference"),
            Field("title", Task.title, searchable=True),
            Field("description", Task.description, searchable=True),
            Field("status", Task.status, kind="enum", facet=True,
                  choices=vocabulary.TASK_STATUS),
            Field("priority", Task.priority, kind="enum", facet=True,
                  choices=vocabulary.PRIORITY),
            Field("kind", Task.kind, kind="enum", facet=True,
                  choices=vocabulary.TASK_KIND),
            Field("due_date", Task.due_date, kind="datetime", label="Due date"),
            Field("progress", Task.progress, kind="number"),
            Field("estimate_hours", Task.estimate_hours, kind="number", label="Estimate (hours)"),
            Field("logged_hours", Task.logged_hours, kind="number", label="Logged (hours)"),
            Field("assignee_id", Task.assignee_id, kind="uuid", label="Assignee ID"),
            Field("project_id", Task.project_id, kind="uuid", label="Project ID"),
            # The board's hand-made order (§18) — sortable so a lane can be
            # read in it; written only through `/api/tasks/<id>/place`.
            Field("board_position", Task.board_position, kind="number",
                  label="Board position", filterable=False),
            # The card's to-do list (§18). Declared so it travels with the
            # record and can be written by the same endpoint everything
            # else is; ticking an item is an edit to the task, not a
            # second kind of write with a second set of rules.
            Field("checklist", Task.checklist, kind="json", filterable=False,
                  sortable=False),
            # Work planning (§18): the timeline's dates, the sprint's
            # points, the hierarchy a board groups by.
            Field("start_date", Task.start_date, kind="datetime", label="Start date"),
            Field("story_points", Task.story_points, kind="number", label="Story points"),
            Field("epic_id", Task.epic_id, kind="uuid", label="Epic ID"),
            Field("parent_id", Task.parent_id, kind="uuid", label="Parent task ID"),
            Field("sprint_id", Task.sprint_id, kind="uuid", label="Sprint ID"),
            Field("is_milestone", Task.is_milestone, kind="bool", label="Milestone"),
            Field("cover_color", Task.cover_color, label="Cover colour", filterable=False),
            Field("blocked_reason", Task.blocked_reason, label="Blocked because"),
            Field("status_changed_at", Task.status_changed_at, kind="datetime",
                  label="In this status since"),
            Field("backlog_rank", Task.backlog_rank, kind="number",
                  label="Backlog rank", filterable=False),
            *_common(Task),
        ),
        ("reference", "title", "status", "priority", "due_date", "progress", "updated_at"),
        route="/tasks", title_field="title", subtitle_field="reference",
        content_fields=("description",),
        insight=Insight(
            metrics=(
                Metric("total", "Work items"),
                Metric("in_progress", "In progress", field="status",
                       equals=("IN_PROGRESS", "IN_REVIEW")),
                Metric("logged", "Hours logged", kind="sum", field="logged_hours",
                       format="hours"),
                Metric("progress", "Average progress", kind="avg", field="progress",
                       format="percent"),
            ),
            breakdowns=("status", "priority", "kind"),
            trend="created_at",
        ),
        editable=(
            Writable("title", required=True),
            Writable("description"),
            Writable("status"),
            Writable("priority"),
            Writable("kind"),
            Writable("due_date"),
            Writable("progress", minimum=0, maximum=100),
            Writable("estimate_hours", minimum=0, maximum=10_000),
            Writable("logged_hours", minimum=0, maximum=10_000),
            Writable("assignee_id"),
            Writable("project_id"),
            Writable("checklist"),
            Writable("start_date"),
            Writable("story_points", minimum=0, maximum=999),
            Writable("epic_id"),
            Writable("parent_id"),
            Writable("is_milestone"),
            Writable("cover_color"),
            Writable("blocked_reason"),
        ),
        identity=Identity("reference", "TSK"),
    )
