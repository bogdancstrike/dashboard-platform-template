"""Saved searches, reports and report documents."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, SoftDeleteMixin, TimestampMixin, fk, uuid_pk


class SavedSearch(Base, TimestampMixin, SoftDeleteMixin):
    """A named advanced query (§5), with the presentation it was saved under.

    Storing columns/sort/page size beside the conditions is deliberate: opening
    a saved search that finds the right rows and then shows the wrong columns
    is a saved search nobody trusts.
    """

    __tablename__ = "saved_searches"
    __table_args__ = (Index("ix_saved_search_owner_scope", "owner_id", "scope"),)

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    resource_type: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    owner_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    team_id: Mapped[UUID | None] = fk("teams.id")
    scope: Mapped[str] = mapped_column(String(16), default="PRIVATE", index=True)
    #: The react-awesome-query-builder tree, compiled by `core/rules.py`.
    condition_tree: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: Human rendering for the query inspector and for list cards (§51).
    condition_text: Mapped[str | None] = mapped_column(Text)
    #: Plain query params, for searches saved from the simple filter bar.
    filters: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    query_text: Mapped[str | None] = mapped_column(String(500))
    sort: Mapped[str | None] = mapped_column(String(120))
    order: Mapped[str] = mapped_column(String(8), default="desc")
    columns: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    page_size: Mapped[int] = mapped_column(Integer, default=25)
    view_mode: Mapped[str] = mapped_column(String(16), default="table")
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    rule_count: Mapped[int] = mapped_column(Integer, default=0)
    use_count: Mapped[int] = mapped_column(Integer, default=0, index=True)
    last_used_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")


class Report(Base, TimestampMixin, SoftDeleteMixin):
    """A saved report definition (§28) — dimensions, metrics, filters, chart."""

    __tablename__ = "reports"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    resource_type: Mapped[str] = mapped_column(String(48), default="order", index=True)
    owner_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    scope: Mapped[str] = mapped_column(String(16), default="PRIVATE", index=True)
    dimensions: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    metrics: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    filters: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    condition_tree: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    group_by: Mapped[str | None] = mapped_column(String(64))
    sort: Mapped[str | None] = mapped_column(String(64))
    order: Mapped[str] = mapped_column(String(8), default="desc")
    period: Mapped[str] = mapped_column(String(32), default="last_30_days")
    visualization: Mapped[str] = mapped_column(String(24), default="bar", index=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    last_run_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    run_count: Mapped[int] = mapped_column(Integer, default=0)
    schedule: Mapped[str | None] = mapped_column(String(64))

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")


class ReportDocument(Base, TimestampMixin, SoftDeleteMixin):
    """A *document*, composed of blocks, that renders to PDF or DOCX (§28).

    Deliberately not a `Report`. A report is a saved *question* — a dataset, a
    grouping, a measure, a picture — and running one answers it. A document is
    a **page**: a cover, headings, paragraphs somebody wrote, and the answers
    to several questions arranged between them. The two were the same screen
    for a while, and the result was two builders that looked alike and did the
    same thing.

    So a block that shows data *names a report* rather than restating one, for
    the reason a dashboard widget does: a question with two definitions has two
    answers the first time either is edited.

    `page` holds the paper — size, orientation, margins, the running header and
    footer, whether pages are numbered — because that is exactly the part a
    person means when they say they want to customise a report, and it is the
    part a chart builder has no place for.
    """

    __tablename__ = "report_documents"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    owner_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    scope: Mapped[str] = mapped_column(String(16), default="PRIVATE", index=True)
    #: Paper and furniture: size, orientation, margins, header, footer, cover.
    page: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: The body, in order. Each entry is one block — see `services/report_documents`.
    blocks: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    last_rendered_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    render_count: Mapped[int] = mapped_column(Integer, default=0)

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")
