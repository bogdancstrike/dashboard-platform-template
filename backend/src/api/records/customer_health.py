"""Customer health (§12): the portfolio, one customer's score, the model."""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services.analytics import jobs as analytics_jobs
from src.services.records import customer_health as service


def _method(request, default: str = "GET") -> str:
    return (request.method if request is not None else default).upper()


@requires("records.view")
def portfolio(app=None, operation: str = "", request=None, **_: Any):
    """Distribution, movers, recent drops and a filtered list of scores."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        analytics_jobs.catch_up(session)
        return service.portfolio(session, args, principal=me()), 200


@requires("records.view")
def customer(app=None, operation: str = "", request=None, **kwargs: Any):
    """One customer's score, band, the why, and the trend."""
    args = request.args if request is not None else {}
    try:
        days = int(args.get("days") or 90)
    except (TypeError, ValueError):
        days = 90
    with session_scope() as session:
        return service.customer(session, kwargs.get("customer_id"), principal=me(), days=days), 200


@requires("records.view")
def model(app=None, operation: str = "", request=None, **_: Any):
    """The weights and thresholds (GET), or new ones (PUT, `health.configure`)."""
    with session_scope() as session:
        if _method(request) == "PUT":
            return service.save_model(session, json_body(), principal=me()), 200
        return service.model_view(session, principal=me()), 200


@requires("health.configure")
def recompute(app=None, operation: str = "", request=None, **_: Any):
    """Score every customer now and snapshot today, recorded as a job."""
    with session_scope() as session:
        return analytics_jobs.run(session, "analytics.customer-health", principal=me()), 200
