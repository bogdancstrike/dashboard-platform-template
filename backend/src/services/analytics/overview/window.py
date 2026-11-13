"""One period of the overview, with the queries several panels share computed once."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from functools import cached_property
from typing import Any

from sqlalchemy import Numeric, cast, func, select

from src.models.business import Order, Project, Ticket
from src.services.analytics.overview.measures import _live
from src.services.analytics.overview.panel_queries import _budget_vs_progress
from src.services.analytics.overview.series import _series


@dataclass
class Window:
    """What a panel builder is given: the session and the period's bounds."""

    session: Any
    start: datetime
    end: datetime

    @cached_property
    def booked(self):
        """Orders that count as revenue."""
        return ~Order.status.in_(("CANCELLED", "REFUNDED"))

    def series(self, column, value, *clauses) -> list[dict[str, Any]]:
        return _series(self.session, column, value, self.start, self.end, *clauses)

    @cached_property
    def ticket_series(self) -> list[dict[str, Any]]:
        return self.series(Ticket.created_at, func.count())

    @cached_property
    def revenue_total(self):
        return func.sum(cast(Order.total, Numeric))

    @cached_property
    def portfolio(self) -> list[dict[str, Any]]:
        return _budget_vs_progress(self.session, Project)

    def grouped(self, column, label_column=None, *clauses, limit: int = 12) -> list[dict[str, Any]]:
        """Live rows counted per value of `column` (labelled by `label_column`)."""
        target = label_column if label_column is not None else column
        stmt = select(target.label("name"), func.count().label("value"))
        for clause in (*_live(column, label_column), *clauses):
            stmt = stmt.where(clause)
        stmt = stmt.group_by(target).order_by(func.count().desc()).limit(limit)
        return [
            {"name": str(row.name or "—"), "value": int(row.value)}
            for row in self.session.execute(stmt).all()
        ]
