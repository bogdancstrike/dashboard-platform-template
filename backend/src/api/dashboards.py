"""Dashboards and their widgets (§45, §67).

Layout only. What each widget *shows* is answered by the endpoint that owns
that question — insights, analysis, explorer, the dashboard feeds — so nothing
here aggregates anything. See `services/dashboards.py` for why that line is
where it is.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import dashboards as service


@requires("records.view")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """Every dashboard this reader may open, or one more of their own."""
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "POST":
            return service.create(session, json_body(), principal=me()), 201
        return service.listing(session, principal=me()), 200


@requires("records.view")
def item(app=None, operation: str = "", request=None, dashboard_id: str = "", **kwargs: Any):
    """One dashboard: read it, change it, or remove it."""
    identifier = dashboard_id or str(kwargs.get("dashboard_id") or "")
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        principal = me()
        if method == "PUT":
            return service.update(session, identifier, json_body(), principal=principal), 200
        if method == "DELETE":
            return service.remove(session, identifier, principal=principal), 200
        return service.get(session, identifier, principal=principal), 200


@requires("records.view")
def widgets(app=None, operation: str = "", request=None, dashboard_id: str = "", **kwargs: Any):
    """Add a widget to a dashboard. Returns the whole layout it now has."""
    identifier = dashboard_id or str(kwargs.get("dashboard_id") or "")
    with session_scope() as session:
        return service.add_widget(session, identifier, json_body(), principal=me()), 201


@requires("records.view")
def widget(
    app=None,
    operation: str = "",
    request=None,
    dashboard_id: str = "",
    widget_id: str = "",
    **kwargs: Any,
):
    """One widget: change what it asks and where it sits, or take it off."""
    board = dashboard_id or str(kwargs.get("dashboard_id") or "")
    target = widget_id or str(kwargs.get("widget_id") or "")
    method = (request.method if request is not None else "PUT").upper()
    with session_scope() as session:
        principal = me()
        if method == "DELETE":
            return service.remove_widget(session, board, target, principal=principal), 200
        return service.update_widget(
            session, board, target, json_body(), principal=principal
        ), 200


@requires("records.view")
def duplicate(app=None, operation: str = "", request=None, dashboard_id: str = "", **kwargs: Any):
    """A private copy of a dashboard the caller may see, owned by them.

    What makes a shared dashboard worth sharing: you can adopt a colleague's
    layout instead of rebuilding it. The copy is private and shares nothing.
    """
    identifier = dashboard_id or str(kwargs.get("dashboard_id") or "")
    with session_scope() as session:
        return service.duplicate(session, identifier, principal=me()), 201


@requires("records.view")
def arrange(app=None, operation: str = "", request=None, dashboard_id: str = "", **kwargs: Any):
    """Every widget's geometry at once, which is what one drag produces."""
    identifier = dashboard_id or str(kwargs.get("dashboard_id") or "")
    with session_scope() as session:
        return service.arrange(session, identifier, json_body(), principal=me()), 200
