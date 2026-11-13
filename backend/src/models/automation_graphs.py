"""Automations as graphs: the canvas's definition, its versions, and what waits (§49).

An automation used to be one sentence — *when records look like this, do these
things* — stored as a condition tree and a list of actions on `alert_rules`.
The canvas lets it be a small program instead: a trigger, conditions, if/else
branches, actions, delays and approvals, joined by edges. That program is the
one stored definition both editors edit; the form editor reads and writes the
straight-line case of it, and the legacy columns on `alert_rules` are derived
from the published graph so every list and filter keeps working.

Three tables, each answering one question:

* `automation_graphs` — *what is it now?* One row per rule: the draft somebody
  is editing, the published graph the engine runs, and the version counter.
  Draft and published are separate because a half-drawn workflow must not run.
* `automation_versions` — *what was it?* Every publish is kept whole, so
  "it stopped working on Tuesday" can be answered by looking at Tuesday's graph
  and restored from it.
* `automation_waits` — *what is it waiting for?* A delay or an approval parks
  the record mid-graph; the scheduler (or the approval decision) resumes it.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, TimestampMixin, fk, uuid_pk


class AutomationGraph(Base, TimestampMixin):
    """The node graph of one automation: draft and published."""

    __tablename__ = "automation_graphs"

    id: Mapped[UUID] = uuid_pk()
    rule_id: Mapped[UUID] = fk("alert_rules.id", ondelete="CASCADE", nullable=False)
    #: What the canvas is editing. Saved on every change; never run.
    draft: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: What the engine runs. Replaced only by publishing.
    published: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: 0 until the first publish.
    version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    published_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    published_by_id: Mapped[UUID | None] = fk("users.id")
    draft_updated_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    draft_updated_by_id: Mapped[UUID | None] = fk("users.id")
    #: The secret in a webhook trigger's address. Minted on the first publish
    #: of a webhook-triggered graph and kept across versions, so the address a
    #: caller was given keeps working when the workflow is edited.
    webhook_token: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)
    #: When a scheduled trigger last ran — the scheduler's bookmark.
    last_scheduled_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (UniqueConstraint("rule_id", name="uq_automation_graph_rule"),)

    rule = relationship("AlertRule", lazy="joined")
    published_by = relationship("User", foreign_keys=[published_by_id], lazy="joined")


class AutomationVersion(Base, TimestampMixin):
    """One published graph, kept whole."""

    __tablename__ = "automation_versions"
    __table_args__ = (UniqueConstraint("rule_id", "version", name="uq_automation_version"),)

    id: Mapped[UUID] = uuid_pk()
    rule_id: Mapped[UUID] = fk("alert_rules.id", ondelete="CASCADE", nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    graph: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    published_by_id: Mapped[UUID | None] = fk("users.id")

    published_by = relationship("User", foreign_keys=[published_by_id], lazy="joined")


class AutomationWait(Base, TimestampMixin):
    """A record parked mid-graph by a delay or an approval.

    `record_id` is text for the reason `alert_rule_fires.record_id` is: the
    wait outlives nothing, but it must not block a record's deletion either.
    """

    __tablename__ = "automation_waits"
    __table_args__ = (Index("ix_automation_wait_due", "status", "due_at"),)

    id: Mapped[UUID] = uuid_pk()
    rule_id: Mapped[UUID] = fk("alert_rules.id", ondelete="CASCADE", nullable=False)
    run_id: Mapped[UUID | None] = fk("alert_rule_runs.id")
    #: The graph version the record was parked under. A resume walks *that*
    #: version, so an edit made while somebody waited cannot send the record
    #: down a branch that did not exist when it stopped.
    version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    node_id: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(48), nullable=False)
    record_id: Mapped[str] = mapped_column(String(64), nullable=False)
    record_label: Mapped[str | None] = mapped_column(String(240))
    #: DELAY or APPROVAL.
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    #: PENDING → RESUMED | CANCELLED.
    status: Mapped[str] = mapped_column(String(16), default="PENDING", nullable=False, index=True)
    due_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    approval_id: Mapped[str | None] = mapped_column(String(64), index=True)
    #: Which port the resume left by: `out`, `approved` or `rejected`.
    outcome: Mapped[str | None] = mapped_column(String(16))
    resumed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
