"""Duplicating a dashboard, and the widgets a new one starts with."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import audit
from src.core.errors import ValidationError
from src.models.personal import Dashboard, DashboardWidget
from src.services.analytics.dashboards.serializers import (
    _serialize,
    _slug,
    _state,
    _visible,
)
from src.services.analytics.dashboards.widget_catalogue import (
    KIND,
    MANAGE_PERMISSION,
    WIDGET_KINDS,
)
from src.services.analytics.dashboards.widget_config import _config
from src.services.analytics.dashboards.widget_sizes import (
    COLUMNS,
    DEFAULT_SIZES,
    MAX_WIDGETS_AT_ONCE,
    _default_title,
)


def _requested_widgets(payload: dict[str, Any], *, principal) -> list[dict[str, Any]]:
    """The widgets a create call asked for, validated and placed left to right.

    Each kind declares the size it wants (`DEFAULT_SIZES`), and the row
    advances by the *tallest* widget in it — the mistake the seed made, which
    left every dashboard full of holes the grid then had to push apart.
    """
    requested = payload.get("widgets") or []
    if not isinstance(requested, list):
        raise ValidationError("widgets must be a list.")
    if len(requested) > MAX_WIDGETS_AT_ONCE:
        raise ValidationError(
            f"A dashboard starts with at most {MAX_WIDGETS_AT_ONCE} widgets.",
            details={"asked_for": len(requested)},
        )

    placed: list[dict[str, Any]] = []
    x = y = row_height = 0
    for entry in requested:
        if not isinstance(entry, dict):
            raise ValidationError("Each widget must be an object.")
        kind = str(entry.get("kind") or "").strip().upper()
        if kind not in WIDGET_KINDS:
            raise ValidationError(
                "That is not a widget this platform can draw.",
                details={"kind": kind, "allowed": sorted(WIDGET_KINDS)},
            )
        width, height = DEFAULT_SIZES.get(kind, (4, 2))
        if x + width > COLUMNS:
            x = 0
            y += row_height
            row_height = 0
        row_height = max(row_height, height)

        placed.append({
            "kind": kind,
            "title": str(entry.get("title") or _default_title(kind))[:200],
            "subtitle": None,
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "config": _config(entry.get("config"), kind=kind, principal=principal),
        })
        x += width

    return placed


def duplicate(session, dashboard_id: Any, *, principal) -> dict[str, Any]:
    """A private copy of a dashboard, owned by whoever asked for it.

    This is what makes sharing *useful* rather than merely visible. A colleague
    publishes the layout they work from; you can open it, but you cannot change
    it — and the thing you actually want is that layout with your own filters
    on it. Without a copy the only route is rebuilding fourteen widgets by
    hand, which is how a shared dashboard turns into fourteen private ones that
    slowly disagree.

    The copy is `PRIVATE` and shares nothing: inheriting the original's
    audience would publish somebody's adaptation to the original's members the
    moment it was made. Its widgets are copied by *value* — geometry and
    config — because a widget is a reference to a question already; the
    reports and searches it names stay the ones it named.
    """
    principal.require(MANAGE_PERMISSION)
    source = _visible(session, dashboard_id, principal)

    row = Dashboard(
        owner_id=principal.user_id,
        organization_id=principal.organization_id,
        name=_copy_name(session, source.name, principal),
        slug=_slug(source.name),
        description=source.description,
        scope="PRIVATE",
        icon=source.icon,
        is_home=False,
        columns=source.columns or COLUMNS,
        filters=dict(source.filters or {}),
    )
    session.add(row)
    session.flush()
    for widget in sorted(source.widgets, key=lambda item: (item.position, item.y, item.x)):
        row.widgets.append(DashboardWidget(
            kind=widget.kind,
            title=widget.title,
            subtitle=widget.subtitle,
            x=widget.x, y=widget.y, width=widget.width, height=widget.height,
            position=widget.position,
            config=dict(widget.config or {}),
        ))
    session.flush()
    audit.record(
        session, action="CREATE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal, after=_state(row),
        message=f"copied dashboard {source.name}", activity=False,
    )
    return _serialize(session, row, principal)


def _copy_name(session, name: str, principal) -> str:
    """"Revenue" once, then "Revenue (2)" — never two things with one name.

    A copy that silently takes the original's name is indistinguishable from
    the original in every list that shows it, which is the moment somebody
    edits the wrong one.
    """
    taken = set(session.scalars(
        select(Dashboard.name).where(
            Dashboard.owner_id == principal.user_id, Dashboard.deleted_at.is_(None)
        )
    ).all())
    if name not in taken:
        return name[:200]
    for suffix in range(2, 100):
        candidate = f"{name} ({suffix})"[:200]
        if candidate not in taken:
            return candidate
    return f"{name} (copy)"[:200]
