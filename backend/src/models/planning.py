"""Work planning: sprints, dependencies, templates, recurrence (§18).

Everything here hangs off the one work queue, `tasks`. A sprint is not a second
kind of task list and a timeline is not a second kind of task: both are ways of
reading the same rows, which is why the new *columns* (start date, story
points, sprint, epic) live on `tasks` and only the things that are genuinely
their own rows live in this module.

* **A sprint** is a time box with a goal, a capacity and a state. Its scope is
  the tasks whose `sprint_id` names it; its history is `sprint_snapshots`, one
  row per day, written by the scheduler — a burndown drawn from today's numbers
  alone is a straight line nobody can learn from.
* **A dependency** is finish-to-start between two tasks, with an optional lag.
  One table rather than an array on the task, because the timeline asks both
  directions ("what waits on this?" and "what does this wait on?").
* **A template** is a task that has not happened yet — its title, checklist
  and estimate — used to create real ones.
* **A recurrence** is a rule that creates the next task when the time comes,
  copying the task it was set on.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


class Sprint(Base, TimestampMixin, SoftDeleteMixin):
    """A time box: PLANNED → ACTIVE → COMPLETED."""

    __tablename__ = "sprints"

    id: Mapped[UUID] = uuid_pk()
    #: The project whose backlog this sprint draws from. Nullable for a team
    #: sprint that spans projects.
    project_id: Mapped[UUID | None] = fk("projects.id", ondelete="CASCADE")
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    goal: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(16), default="PLANNED", nullable=False, index=True)
    start_date: Mapped[Any | None] = mapped_column(Date)
    end_date: Mapped[Any | None] = mapped_column(Date)
    #: Points the team expects to finish — a planning aid, never enforced.
    capacity_points: Mapped[Any | None] = mapped_column(Numeric(7, 1))
    #: Frozen when the sprint starts / completes, so the velocity chart reads
    #: what was promised and what was delivered rather than today's scope.
    committed_points: Mapped[Any | None] = mapped_column(Numeric(7, 1))
    completed_points: Mapped[Any | None] = mapped_column(Numeric(7, 1))
    started_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    #: What the completion did with unfinished work, for the sprint report.
    report: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_by_id: Mapped[UUID | None] = fk("users.id")


class SprintSnapshot(Base):
    """One day of a sprint, as the burndown reads it."""

    __tablename__ = "sprint_snapshots"
    __table_args__ = (UniqueConstraint("sprint_id", "day", name="uq_sprint_snapshot_day"),)

    id: Mapped[UUID] = uuid_pk()
    sprint_id: Mapped[UUID] = fk("sprints.id", ondelete="CASCADE", nullable=False)
    day: Mapped[Any] = mapped_column(Date, nullable=False)
    total_points: Mapped[Any] = mapped_column(Numeric(7, 1), default=0, nullable=False)
    done_points: Mapped[Any] = mapped_column(Numeric(7, 1), default=0, nullable=False)
    remaining_points: Mapped[Any] = mapped_column(Numeric(7, 1), default=0, nullable=False)
    total_tasks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    done_tasks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class TaskDependency(Base, TimestampMixin):
    """`successor` cannot start until `predecessor` finishes (+ lag days)."""

    __tablename__ = "task_dependencies"
    __table_args__ = (
        UniqueConstraint("predecessor_id", "successor_id", name="uq_task_dependency_pair"),
    )

    id: Mapped[UUID] = uuid_pk()
    predecessor_id: Mapped[UUID] = fk("tasks.id", ondelete="CASCADE", nullable=False)
    successor_id: Mapped[UUID] = fk("tasks.id", ondelete="CASCADE", nullable=False)
    #: Only finish-to-start for now; a column so the others need no migration.
    kind: Mapped[str] = mapped_column(String(4), default="FS", nullable=False)
    lag_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by_id: Mapped[UUID | None] = fk("users.id")


class TaskWatcher(Base):
    """Somebody who wants to hear about a task they are not assigned to."""

    __tablename__ = "task_watchers"

    task_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True,
        index=True,
    )
    created_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False)


class TaskTemplate(Base, TimestampMixin, SoftDeleteMixin):
    """A task that has not happened yet."""

    __tablename__ = "task_templates"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(24), default="TASK")
    priority: Mapped[str] = mapped_column(String(16), default="NORMAL")
    estimate_hours: Mapped[Any | None] = mapped_column(Numeric(8, 2))
    story_points: Mapped[Any | None] = mapped_column(Numeric(5, 1))
    checklist: Mapped[list[Any] | None] = mapped_column(JSONB)
    labels: Mapped[list[str] | None] = mapped_column(ARRAY(String(48)))
    cover_color: Mapped[str | None] = mapped_column(String(16))
    #: How long after creation the copy is due, in days. `None` is no due date.
    due_in_days: Mapped[int | None] = mapped_column(Integer)
    usage_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    owner_id: Mapped[UUID | None] = fk("users.id")


class TaskRecurrence(Base, TimestampMixin):
    """Make the next one when the time comes.

    `frequency` is DAILY · WEEKLY · MONTHLY · CUSTOM; CUSTOM is "every
    `interval` `unit`s" (days or weeks). WEEKLY may name weekdays (0 = Monday).
    """

    __tablename__ = "task_recurrences"
    __table_args__ = (Index("ix_task_recurrence_due", "active", "next_run_at"),)

    id: Mapped[UUID] = uuid_pk()
    #: The task copied each time — the one the rule was set on. A rule outlives
    #: the occurrences it made; it does not outlive the task it copies.
    task_id: Mapped[UUID] = fk("tasks.id", ondelete="CASCADE", nullable=False)
    frequency: Mapped[str] = mapped_column(String(12), default="WEEKLY", nullable=False)
    interval: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit: Mapped[str] = mapped_column(String(8), default="DAY", nullable=False)
    weekdays: Mapped[list[int] | None] = mapped_column(ARRAY(Integer))
    month_day: Mapped[int | None] = mapped_column(Integer)
    until: Mapped[Any | None] = mapped_column(Date)
    next_run_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    last_run_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    occurrences: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_id: Mapped[UUID | None] = fk("users.id")


class TaskLaneSetting(Base):
    """A work-in-progress limit for one column of the task board."""

    __tablename__ = "task_lane_settings"

    status: Mapped[str] = mapped_column(String(24), primary_key=True)
    wip_limit: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))


def _stamp_status_change(target, value, oldvalue, _initiator):
    """A card's age in its lane starts when its status changes — however it changed."""
    from datetime import datetime, timezone

    from sqlalchemy.orm.attributes import NO_VALUE

    if oldvalue is NO_VALUE or oldvalue is None or value == oldvalue:
        return
    target.status_changed_at = datetime.now(timezone.utc)


def _install() -> None:
    from sqlalchemy import event

    from src.models.business import Task

    if not event.contains(Task.status, "set", _stamp_status_change):
        event.listen(Task.status, "set", _stamp_status_change)


_install()
