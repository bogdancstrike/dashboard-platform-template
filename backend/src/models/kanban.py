"""Kanban boards: a board somebody owns, its lanes, and the cards on them (§18).

**Why this is not `/tasks`.** The task board is a view of the *work queue*: its
lanes are the declared `TASK_STATUS` vocabulary, which every filter, chart and
report in the platform also reads. A lane somebody invents there would be a
status nothing else has heard of — a card in it would vanish from every report
that counts by status. So `/tasks` keeps the vocabulary and this table exists
for the other thing people mean by a board: a workspace of their own, whose
columns are theirs to name.

That single decision explains the shape of everything here.

**A lane is a row, not a value.** It has a name somebody typed, a position they
dragged it to, and a work-in-progress limit they chose. Deleting one has to
decide what happens to its cards, which is why `lane_id` is nullable and why
the service moves them rather than cascading.

**The hierarchy is one self-reference, not three tables.** An epic holds
stories, a story holds tasks and bugs. Three tables would mean three sets of
comments, three sets of permissions and three endpoints that all mean "a piece
of work"; one table with a `kind` and a `parent_id` means a card is a card,
and `kind` is what a reader sees. The *rule* about which kind may parent which
lives in the service, where it can be stated once.

**Order is an integer, and it is dense within a lane.** A float midpoint
("insert between 3.0 and 4.0") avoids rewriting neighbours and drifts into
precision nobody can debug; a dense integer means a drop rewrites the cards
after it in that lane, which is a handful of rows and always readable in psql.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, Date, DateTime, Index, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import (
    Base,
    MetadataMixin,
    SoftDeleteMixin,
    TimestampMixin,
    fk,
    uuid_pk,
)


class Board(Base, TimestampMixin, SoftDeleteMixin, MetadataMixin):
    """One workspace, owned by a person and shared the way everything is (§5)."""

    __tablename__ = "kanban_boards"

    id: Mapped[UUID] = uuid_pk()
    #: A short handle that prefixes every card's reference — `PLAT-00042`.
    #: Stored so the references stay stable if the board is renamed.
    key: Mapped[str] = mapped_column(String(12), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    owner_id: Mapped[UUID | None] = fk("users.id")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    #: PRIVATE · SHARED · PUBLIC — `core/sharing`'s vocabulary, not a second one.
    scope: Mapped[str] = mapped_column(String(16), default="PRIVATE", index=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    lanes = relationship(
        "BoardLane",
        back_populates="board",
        cascade="all, delete-orphan",
        order_by="BoardLane.position",
        lazy="selectin",
    )


class BoardLane(Base, TimestampMixin, SoftDeleteMixin):
    """A column somebody named, in the order they dragged it to."""

    __tablename__ = "kanban_lanes"
    __table_args__ = (Index("ix_kanban_lane_board_position", "board_id", "position"),)

    id: Mapped[UUID] = uuid_pk()
    board_id: Mapped[UUID] = fk("kanban_boards.id", ondelete="CASCADE", nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    #: How many cards this lane should hold before it is a problem. `None` is
    #: "no limit" — a limit of zero would be a lane nothing may enter.
    wip_limit: Mapped[int | None] = mapped_column(Integer)
    #: Whether arriving here means finished. One lane per board at most; the
    #: service enforces that, because two "done" columns is two answers to
    #: "how much have we shipped".
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)

    board = relationship("Board", back_populates="lanes")


class BoardCard(Base, TimestampMixin, SoftDeleteMixin, MetadataMixin):
    """A piece of work: an epic, a story, a task or a bug.

    One table for all four — see the module docstring. `parent_id` is the
    hierarchy and `kind` is what a reader sees.
    """

    __tablename__ = "kanban_cards"
    __table_args__ = (
        # The board's own query: everything in one lane, in order.
        Index("ix_kanban_card_lane_position", "lane_id", "position"),
        Index("ix_kanban_card_board_kind", "board_id", "kind"),
    )

    id: Mapped[UUID] = uuid_pk()
    board_id: Mapped[UUID] = fk("kanban_boards.id", ondelete="CASCADE", nullable=False)
    #: Nullable so a lane can be deleted without taking its cards with it: the
    #: service moves them to another lane, and a card that is briefly in none
    #: is better than a delete that destroys work.
    lane_id: Mapped[UUID | None] = fk("kanban_lanes.id", ondelete="SET NULL")
    #: `PLAT-00042`. Unique, quotable, and stable across every move.
    reference: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    kind: Mapped[str] = mapped_column(String(16), default="TASK", nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    #: A story's epic, or a task's story. The rule about which kind may parent
    #: which is in `services/kanban`, stated once.
    parent_id: Mapped[UUID | None] = fk("kanban_cards.id", ondelete="SET NULL")
    #: Dense within the lane; a drop rewrites the cards after it.
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    priority: Mapped[str] = mapped_column(String(16), default="NORMAL", index=True)
    #: Points, not hours: the board is for planning and the platform already
    #: tracks hours on `tasks`.
    story_points: Mapped[Any | None] = mapped_column(Numeric(5, 1))
    assignee_id: Mapped[UUID | None] = fk("users.id")
    reporter_id: Mapped[UUID | None] = fk("users.id")
    labels: Mapped[list[str] | None] = mapped_column(ARRAY(String(40)))
    due_date: Mapped[Any | None] = mapped_column(Date)
    started_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    #: `[{"text": ..., "done": bool}]` — a document on the card, audited with
    #: it, exactly as `tasks.checklist` is. A table would be a second set of
    #: rules about who may tick a box.
    checklist: Mapped[list[Any] | None] = mapped_column(JSONB)

    assignee = relationship("User", foreign_keys=[assignee_id], lazy="joined")
    lane = relationship("BoardLane", foreign_keys=[lane_id])
