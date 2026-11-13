"""Adding, changing, removing and arranging widgets."""

from __future__ import annotations

from typing import Any

from src.core import audit
from src.core.errors import ValidationError
from src.models.personal import DashboardWidget
from src.services.analytics.dashboards.serializers import _owned, _serialize, _widget_of
from src.services.analytics.dashboards.validation import _geometry, _validated_widget
from src.services.analytics.dashboards.widget_catalogue import KIND, MANAGE_PERMISSION


def add_widget(session, dashboard_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """One more card on the grid, where it was dropped or else at the bottom.

    A caller that says where it goes gets that. A caller that does not — the
    widget drawer, and "add this saved chart to a dashboard" from anywhere else
    in the product — used to get `(0, 0)`, which is *on top of* whatever the
    dashboard already had: the grid then shoved every existing card down to
    make room, so adding a card rearranged the dashboard somebody had
    arranged. Appending below everything is the only placement that leaves the
    rest of the layout alone.
    """
    principal.require(MANAGE_PERMISSION)
    row = _owned(session, dashboard_id, principal)
    values = _validated_widget(payload, principal=principal, partial=False, columns=row.columns)
    if "x" not in payload and "y" not in payload:
        values["x"] = 0
        values["y"] = max((w.y + w.height for w in row.widgets), default=0)

    widget = DashboardWidget(position=len(row.widgets), **values)
    # Appended to the relationship rather than inserted beside it: the loaded
    # collection is what gets serialised back, and a plain `session.add` leaves
    # it stale — the caller would be told their new widget is not there.
    row.widgets.append(widget)
    session.flush()
    audit.record(
        session, action="UPDATE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal,
        message=f"added {widget.kind} to {row.name}", activity=False,
    )
    return _serialize(session, row, principal)


def update_widget(
    session, dashboard_id: Any, widget_id: Any, payload: dict[str, Any], *, principal
) -> dict[str, Any]:
    """Move it, resize it, retitle it, or change the question it asks."""
    principal.require(MANAGE_PERMISSION)
    row = _owned(session, dashboard_id, principal)
    widget = _widget_of(row, widget_id)
    values = _validated_widget(
        payload, principal=principal, partial=True, columns=row.columns, existing=widget,
    )
    for key, value in values.items():
        setattr(widget, key, value)
    session.flush()
    audit.record(
        session, action="UPDATE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal,
        message=f"changed {widget.title} on {row.name}", activity=False,
    )
    return _serialize(session, row, principal)


def remove_widget(session, dashboard_id: Any, widget_id: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    row = _owned(session, dashboard_id, principal)
    widget = _widget_of(row, widget_id)
    title = widget.title
    # Removed from the collection for the same reason it was appended to it.
    row.widgets.remove(widget)
    session.flush()
    audit.record(
        session, action="UPDATE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal,
        message=f"removed {title} from {row.name}", activity=False,
    )
    return _serialize(session, row, principal)


def arrange(session, dashboard_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Every widget's geometry at once, which is what a drag actually produces.

    One request rather than one per card: dragging a widget reflows the ones
    around it, and sending five updates lets a reader reload between them and
    find a layout that never existed.
    """
    principal.require(MANAGE_PERMISSION)
    row = _owned(session, dashboard_id, principal)

    placements = payload.get("widgets")
    if not isinstance(placements, list) or not placements:
        raise ValidationError("widgets must be a non-empty list of placements.")

    known = {str(widget.id): widget for widget in row.widgets}
    for position, placement in enumerate(placements):
        if not isinstance(placement, dict):
            raise ValidationError("Each placement must be an object.")
        widget = known.get(str(placement.get("id") or ""))
        if widget is None:
            raise ValidationError(
                "That widget is not on this dashboard.",
                details={"id": str(placement.get("id") or ""), "dashboard": str(row.id)},
            )
        geometry = _geometry(placement, columns=row.columns, existing=widget)
        for key, value in geometry.items():
            setattr(widget, key, value)
        widget.position = position

    session.flush()
    audit.record(
        session, action="UPDATE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal,
        message=f"rearranged {row.name}", activity=False,
    )
    return _serialize(session, row, principal)
