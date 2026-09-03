"""Dashboard endpoints (§2, §44, §66).

One request returns the whole overview — KPIs, charts, alerts and the activity
feed. Split across six endpoints it would be six round trips for a screen
people open first thing every morning, and the period filter would have to be
applied identically in six places.
"""

from __future__ import annotations

from typing import Any

from src.core.db import session_scope
from src.services import dashboard as service


def summary(app=None, operation: str = "", request=None, **_: Any):
    """The overview, for one period.

    `?period=last_30_days` or `?period=custom&from=…&to=…`. The range is
    resolved server-side so the KPI tile and the chart beneath it mean the same
    thing by "this month".
    """
    args = request.args if request is not None else {}
    period = args.get("period") or "last_30_days"

    with session_scope() as session:
        return service.summary(
            session,
            period=period,
            frm=args.get("from"),
            to=args.get("to"),
        ), 200


def alerts(app=None, operation: str = "", request=None, **_: Any):
    """Just the alert strip, for the polling the dashboard does between loads."""
    with session_scope() as session:
        items = service.alerts(session)
        return {"items": items, "total": len(items)}, 200
