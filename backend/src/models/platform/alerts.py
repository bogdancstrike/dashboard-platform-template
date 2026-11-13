"""Alert rules (automations), their runs and fires."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


class AlertRule(Base, TimestampMixin, SoftDeleteMixin):
    """Condition → action automation (§49). The condition is the same query
    tree shape the advanced search builds, so one editor serves both."""

    __tablename__ = "alert_rules"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    resource_type: Mapped[str] = mapped_column(String(48), default="task", index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    severity: Mapped[str] = mapped_column(String(16), default="WARNING", index=True)
    condition_tree: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    condition_text: Mapped[str | None] = mapped_column(Text)
    #: [{type: NOTIFY|EMAIL|TASK|WEBHOOK, ...}]
    actions: Mapped[list[Any] | None] = mapped_column(JSONB)
    schedule: Mapped[str] = mapped_column(String(32), default="*/15 * * * *")
    cooldown_minutes: Mapped[int] = mapped_column(Integer, default=60)
    owner_id: Mapped[UUID | None] = fk("users.id")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    last_triggered_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    trigger_count: Mapped[int] = mapped_column(Integer, default=0)
    last_match_count: Mapped[int] = mapped_column(Integer, default=0)

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")
    runs = relationship(
        "AlertRuleRun", back_populates="rule", cascade="all, delete-orphan",
        order_by="AlertRuleRun.started_at.desc()",
    )
    fires = relationship("AlertRuleFire", back_populates="rule", cascade="all, delete-orphan")


class AlertRuleRun(Base, TimestampMixin):
    """One evaluation of a rule: what it matched, what it did, what it held back.

    Append-only, and the thing the workflow page actually shows — "it ran, it
    matched eleven tickets, it acted on two and the cooldown held back nine" is
    the only answer that makes an automation trustworthy. A rule that reported
    nothing but its own `last_triggered_at` is a rule nobody can audit.

    `detail` carries a *bounded sample* of the per-record outcomes rather than
    all of them: the counts beside it are the summary, and a sample is not a
    second copy of them. Five hundred matched records would otherwise put five
    hundred objects in a column that gets read on a list screen.
    """

    __tablename__ = "alert_rule_runs"
    __table_args__ = (Index("ix_alert_run_rule_time", "rule_id", "started_at"),)

    id: Mapped[UUID] = uuid_pk()
    rule_id: Mapped[UUID] = fk("alert_rules.id", ondelete="CASCADE", nullable=False)
    #: A dry run evaluates and reports; it writes no notification, no task, no
    #: email and no cooldown. Recorded so the history distinguishes "we tried
    #: it" from "it happened".
    dry_run: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    #: Who asked. Null once a scheduler runs it unattended (§23).
    triggered_by_id: Mapped[UUID | None] = fk("users.id")
    started_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    finished_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    matched: Mapped[int] = mapped_column(Integer, default=0)
    fired: Mapped[int] = mapped_column(Integer, default=0)
    #: Matched, and deliberately not acted on because this record was acted on
    #: within the cooldown. The number that answers "why did it go quiet".
    suppressed: Mapped[int] = mapped_column(Integer, default=0)
    #: Matched, within neither cooldown nor this run's fire budget — they wait
    #: for the next run rather than being dropped.
    deferred: Mapped[int] = mapped_column(Integer, default=0)
    #: Per-action tallies and a sample of the records, for the run drawer.
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: Set when the *evaluation* failed — a condition naming a field that has
    #: since been renamed, say. An action that failed is in `detail`: one
    #: unreachable webhook must not lose the notification beside it.
    error: Mapped[str | None] = mapped_column(Text)

    rule = relationship("AlertRule", back_populates="runs")
    triggered_by = relationship("User", foreign_keys=[triggered_by_id], lazy="joined")


class AlertRuleFire(Base, TimestampMixin):
    """When a rule last acted on one record — the cooldown ledger.

    **Keyed per record, which is the whole point.** A cooldown held against the
    *rule* would let one run send forty messages about forty breached tickets
    and then go silent about the forty-first; §49 asks for the opposite. So the
    unit of "we have already said this" is the pair, and one row per pair is
    upserted rather than appended: this table is state, not history, and its
    size is bounded by rules × records instead of growing with every run.

    `record_id` is text because the ledger outlives the record. A rule that
    acted on a ticket somebody then deleted must still remember that it did,
    and a foreign key would either block the delete or erase the memory.
    """

    __tablename__ = "alert_rule_fires"
    __table_args__ = (
        UniqueConstraint("rule_id", "record_id", name="uq_alert_fire_record"),
        Index("ix_alert_fire_recent", "rule_id", "last_fired_at"),
    )

    id: Mapped[UUID] = uuid_pk()
    rule_id: Mapped[UUID] = fk("alert_rules.id", ondelete="CASCADE", nullable=False)
    record_id: Mapped[str] = mapped_column(String(64), nullable=False)
    #: What the record was called when it last fired, so the history reads as
    #: sentences after the record has moved on.
    record_label: Mapped[str | None] = mapped_column(String(240))
    #: The cooldown reads *this*, not the mixin's `updated_at`: correcting a
    #: record's label is a write to the row and must not extend a silence.
    last_fired_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    fire_count: Mapped[int] = mapped_column(Integer, default=0)

    rule = relationship("AlertRule", back_populates="fires")
