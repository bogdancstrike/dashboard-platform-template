"""Anomaly alerts (§22): metric watches, their charts, and what they flagged."""

from __future__ import annotations

from typing import Any

from src.api.handler import Call, endpoint
from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services.analytics import jobs as analytics_jobs
from src.services.analytics import metric_watches as service


def _method(request, default: str = "GET") -> str:
    return (request.method if request is not None else default).upper()


def _args(request):
    return request.args if request is not None else {}


@requires("records.view")
@endpoint
def catalogue(call: Call):
    """What a watch may name: datasets, measures, dates, methods."""
    return service.catalogue(principal=me()), 200


@requires("records.view")
def watches(app=None, operation: str = "", request=None, **_: Any):
    """Every watch (GET), or a new one (POST, `alerts.manage`)."""
    with session_scope() as session:
        if _method(request) == "POST":
            return service.create(session, json_body(), principal=me()), 201
        return service.listing(session, _args(request), principal=me()), 200


@requires("records.view")
def watch(app=None, operation: str = "", request=None, **kwargs: Any):
    """One watch: read, edit or delete it."""
    ident = kwargs.get("watch_id")
    method = _method(request)
    with session_scope() as session:
        if method == "PUT":
            return service.update(session, ident, json_body(), principal=me()), 200
        if method == "DELETE":
            return service.remove(session, ident, principal=me()), 200
        return service.get(session, ident, principal=me()), 200


@requires("records.view")
def chart(app=None, operation: str = "", request=None, **kwargs: Any):
    """The watched series with its expected band and the flagged points."""
    with session_scope() as session:
        return service.chart(session, kwargs.get("watch_id"), _args(request), principal=me()), 200


@requires("records.view")
def evaluate(app=None, operation: str = "", request=None, **kwargs: Any):
    """Judge the latest points now."""
    with session_scope() as session:
        return service.evaluate_now(session, kwargs.get("watch_id"), principal=me()), 200


@requires("records.view")
def silence(app=None, operation: str = "", request=None, **kwargs: Any):
    """Snooze, mute or unsilence a watch."""
    with session_scope() as session:
        return service.silence(session, kwargs.get("watch_id"), json_body(), principal=me()), 200


@requires("records.view")
@endpoint
def preview(call: Call):
    """What a draft watch would see and flag, without saving it."""
    with session_scope() as session:
        return service.preview(session, call.body, principal=me()), 200


@requires("records.view")
def anomalies(app=None, operation: str = "", request=None, **_: Any):
    """The alert history across watches."""
    with session_scope() as session:
        return service.anomalies(session, _args(request), principal=me()), 200


@requires("records.view")
def anomaly(app=None, operation: str = "", request=None, **kwargs: Any):
    """One flagged point with the window it was judged against."""
    with session_scope() as session:
        return service.anomaly(session, kwargs.get("anomaly_id"), principal=me()), 200


@requires("records.view")
def acknowledge(app=None, operation: str = "", request=None, **kwargs: Any):
    """Mark an alert as seen."""
    with session_scope() as session:
        return service.acknowledge(session, kwargs.get("anomaly_id"), principal=me()), 200


@requires("alerts.manage")
@endpoint
def run_all(call: Call):
    """Evaluate every watch now, recorded as a job."""
    with session_scope() as session:
        return analytics_jobs.run(session, "analytics.anomaly-watch", principal=me()), 200
