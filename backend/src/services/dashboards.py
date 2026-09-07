"""Dashboards: a layout of widgets, saved and shared (§45, §67).

What this service owns is deliberately small — *where the widgets are and what
question each one asks*. It computes no aggregates of its own. A KPI widget is
answered by `/api/explorer/insights`, a chart widget by `/api/analysis/run`, a
list by `/api/explorer/query`, the alert strip and the activity feed by
`/api/dashboard/*`. Every one of those is already declared, already aggregated
in PostgreSQL and already permission-checked, and a dashboard that recomputed
any of them would be a second answer to a question the platform has already
answered — wrong the first time the two drift.

So a widget is a *reference to a question*, not a copy of one. That is also
what makes "a saved chart becomes a dashboard widget without being rebuilt"
true rather than aspirational: the widget names the report, and running it
takes the stored definition through the same compiler the chart builder
previewed with.

Sharing is `core/sharing`, exactly as saved searches and reports use it —
private by default, shared with named members, public, and only the owner
writes. One mechanism for every saved thing is the point of that module.

Two rules the layout enforces, because a grid that does not is a grid that
eventually renders on top of itself:

* **A widget fits its dashboard.** `x + width` may not exceed the column
  count, and both are checked on write rather than clamped on read.
* **One home dashboard per person** (§67). Marking one clears the others, in
  the same transaction, because two homes is a preference that cannot be
  honoured.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select, update as sql_update
from sqlalchemy.orm import selectinload

from src.core import audit, sharing
from src.core.clock import now
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.models.personal import Dashboard, DashboardWidget
from src.services.explorer import resource_for, resources

#: The polymorphic key `resource_shares` files a dashboard's audience under.
KIND = "dashboard"

MANAGE_PERMISSION = "dashboards.manage"
SHARE_PERMISSION = "searches.share"

#: What a widget can be. Every one of these has a renderer on the client and a
#: question it is answered by; a kind that has neither is a card that draws an
#: apology.
WIDGET_KINDS = frozenset({
    "KPI",
    "GAUGE",
    "LIST",
    "TABLE",
    "ACTIVITY",
    "ALERTS",
    "LINE_CHART",
    "AREA_CHART",
    "BAR_CHART",
    "PIE_CHART",
    "HEATMAP",
})

#: Kinds that read a dataset. `ACTIVITY` and `ALERTS` are platform-wide feeds
#: and name no entity, which is why the entity is required of the rest rather
#: than of all of them.
DATASET_KINDS = WIDGET_KINDS - {"ACTIVITY", "ALERTS"}

#: The widest a dashboard may be. Twelve is the grid every layout in the
#: product is built on; anything else would need a second set of breakpoints.
COLUMNS = 12

#: A widget shorter than this is a title with no room for an answer.
MIN_HEIGHT = 1
MAX_HEIGHT = 8


def listing(session, *, principal) -> dict[str, Any]:
    """Every dashboard this reader may open, their own first."""
    rows = session.scalars(
        select(Dashboard)
        .options(selectinload(Dashboard.owner), selectinload(Dashboard.widgets))
        .where(Dashboard.deleted_at.is_(None), sharing.visibility(Dashboard, KIND, principal))
        .order_by(Dashboard.is_home.desc(), Dashboard.updated_at.desc(), Dashboard.name.asc())
    ).unique().all()

    return {
        "items": [_serialize(session, row, principal, widgets=False) for row in rows],
        "total": len(rows),
        "widget_kinds": sorted(WIDGET_KINDS),
        "columns": COLUMNS,
        # The datasets a widget may point at, so the builder cannot offer one
        # this reader may not read.
        "datasets": [
            {"key": resource.key, "label": resource.label, "path": resource.path}
            for resource in resources().values()
            if principal.can(resource.permission)
        ],
        "can_create": principal.can(MANAGE_PERMISSION),
        "can_share": principal.can(SHARE_PERMISSION),
    }


def get(session, dashboard_id: Any, *, principal) -> dict[str, Any]:
    return _serialize(session, _visible(session, dashboard_id, principal), principal)


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    values = _validated(payload, principal=principal, partial=False)
    members = values.pop("member_ids")
    home = values.pop("is_home", False)

    row = Dashboard(
        owner_id=principal.user_id,
        organization_id=principal.organization_id,
        slug=_slug(values["name"]),
        **values,
    )
    session.add(row)
    session.flush()
    if home:
        _make_home(session, row, principal)
    sharing.replace_members(
        session, KIND, row.id, members, principal=principal, owner_id=row.owner_id,
    )
    audit.record(
        session, action="CREATE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal, after=_state(row),
        message=f"created dashboard {row.name}", activity=False,
    )
    return _serialize(session, row, principal)


def update(session, dashboard_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    row = _owned(session, dashboard_id, principal)
    values = _validated(payload, principal=principal, partial=True, existing=row)
    members = values.pop("member_ids", None)
    home = values.pop("is_home", None)
    before = _state(row)

    for key, value in values.items():
        setattr(row, key, value)
    if home is not None:
        if home:
            _make_home(session, row, principal)
        else:
            row.is_home = False
    if members is not None:
        sharing.replace_members(
            session, KIND, row.id, members, principal=principal, owner_id=row.owner_id,
        )
    session.flush()
    audit.record(
        session,
        action="SHARE" if "scope" in values or members is not None else "UPDATE",
        resource_type=KIND, resource_id=row.id, resource_label=row.name,
        principal=principal, before=before, after=_state(row),
        message=f"updated dashboard {row.name}", activity=False,
    )
    return _serialize(session, row, principal)


def remove(session, dashboard_id: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    row = _owned(session, dashboard_id, principal)
    before = _state(row)
    row.deleted_at = now()
    audit.record(
        session, action="DELETE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal, before=before,
        message=f"deleted dashboard {row.name}", activity=False,
    )
    # The id and the name, so the caller can say what went rather than only
    # that something did.
    return {"id": str(row.id), "deleted": True, "name": row.name}


# ── widgets ──────────────────────────────────────────────────────────────


def add_widget(session, dashboard_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """One more card on the grid, placed where it was dropped."""
    principal.require(MANAGE_PERMISSION)
    row = _owned(session, dashboard_id, principal)
    values = _validated_widget(payload, principal=principal, partial=False, columns=row.columns)

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


# ── validation ───────────────────────────────────────────────────────────


def _validated(
    payload: dict[str, Any], *, principal, partial: bool, existing: Dashboard | None = None
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("The dashboard must be a JSON object.")

    out: dict[str, Any] = {}

    if not partial or "name" in payload:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValidationError("A dashboard needs a name people will recognise.")
        out["name"] = name[:200]

    if "description" in payload:
        description = payload.get("description")
        out["description"] = str(description).strip()[:2000] if description else None

    if "icon" in payload:
        icon = payload.get("icon")
        out["icon"] = str(icon).strip()[:48] if icon else None

    if not partial or "scope" in payload:
        out["scope"] = sharing.scope_of(
            payload.get("scope"),
            current=existing.scope if existing else "PRIVATE",
            principal=principal,
            share_permission=SHARE_PERMISSION,
        )

    if "is_home" in payload:
        out["is_home"] = bool(payload.get("is_home"))
    elif not partial:
        out["is_home"] = False

    if "filters" in payload:
        filters = payload.get("filters")
        if filters is not None and not isinstance(filters, dict):
            raise ValidationError("filters must be an object.")
        out["filters"] = filters

    if not partial or "member_ids" in payload:
        out["member_ids"] = sharing.requested_members(payload)

    return out


def _validated_widget(
    payload: dict[str, Any],
    *,
    principal,
    partial: bool,
    columns: int,
    existing: DashboardWidget | None = None,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("The widget must be a JSON object.")

    out: dict[str, Any] = {}

    if not partial or "kind" in payload:
        kind = str(payload.get("kind") or "").strip().upper()
        if kind not in WIDGET_KINDS:
            raise ValidationError(
                "That is not a widget this platform can draw.",
                details={"kind": kind, "allowed": sorted(WIDGET_KINDS)},
            )
        out["kind"] = kind

    kind = out.get("kind") or (existing.kind if existing else "")

    if not partial or "title" in payload:
        title = str(payload.get("title") or "").strip()
        if not title:
            raise ValidationError("A widget needs a title, so a reader knows what it answers.")
        out["title"] = title[:200]

    if "subtitle" in payload:
        subtitle = payload.get("subtitle")
        out["subtitle"] = str(subtitle).strip()[:240] if subtitle else None

    if not partial or "config" in payload:
        out["config"] = _config(payload.get("config"), kind=kind, principal=principal)

    out.update(_geometry(payload, columns=columns, existing=existing, partial=partial))
    return out


def _config(raw: Any, *, kind: str, principal) -> dict[str, Any]:
    """What the widget asks, checked against what may actually be asked.

    Deliberately shallow: the *shape* of the question is validated here — a
    real dataset, a real period — and the question itself is executed by the
    endpoint that owns it. Re-deriving which fields are groupable would be a
    second copy of the analysis catalogue.
    """
    config = dict(raw or {})
    entity = str(config.get("entity") or "").strip()

    if kind in DATASET_KINDS:
        if not entity:
            raise ValidationError(
                "That widget reads a dataset, so it has to name one.",
                details={"kind": kind},
            )
        # Checked against the reader's own permissions: a widget pointing at a
        # dataset they may not read would be a card that always says forbidden.
        resource_for(entity, principal=principal)
        config["entity"] = entity
    elif entity:
        raise ValidationError(
            "That widget is a platform-wide feed and names no dataset.",
            details={"kind": kind, "entity": entity},
        )

    filters = config.get("filters")
    if filters is not None and not isinstance(filters, dict):
        raise ValidationError("config.filters must be an object.")

    return config


def _geometry(
    payload: dict[str, Any],
    *,
    columns: int,
    existing: DashboardWidget | None = None,
    partial: bool = True,
) -> dict[str, Any]:
    """Where the card sits, checked so a grid cannot render on top of itself."""
    out: dict[str, Any] = {}

    def number(key: str, default: int) -> int:
        if key in payload:
            try:
                return int(payload[key])
            except (TypeError, ValueError) as exc:
                raise ValidationError(f"{key} must be a whole number.") from exc
        if existing is not None:
            return int(getattr(existing, key))
        return default

    width = number("width", 3)
    height = number("height", 2)
    x = number("x", 0)
    y = number("y", 0)

    if not 1 <= width <= columns:
        raise ValidationError(
            f"A widget is between 1 and {columns} columns wide.",
            details={"width": width, "columns": columns},
        )
    if not MIN_HEIGHT <= height <= MAX_HEIGHT:
        raise ValidationError(
            f"A widget is between {MIN_HEIGHT} and {MAX_HEIGHT} rows tall.",
            details={"height": height},
        )
    if x < 0 or y < 0:
        raise ValidationError("A widget sits at a non-negative position.")
    if x + width > columns:
        # Refused rather than clamped: a card silently narrowed on save is a
        # layout the reader did not choose and cannot undo.
        raise ValidationError(
            "That widget would hang off the right of the grid.",
            details={"x": x, "width": width, "columns": columns},
        )

    if not partial or any(key in payload for key in ("x", "y", "width", "height")):
        out.update({"x": x, "y": y, "width": width, "height": height})
    return out


# ── plumbing ─────────────────────────────────────────────────────────────


def _make_home(session, row: Dashboard, principal) -> None:
    """This one, and only this one (§67)."""
    session.execute(
        sql_update(Dashboard)
        .where(Dashboard.owner_id == principal.user_id, Dashboard.id != row.id)
        .values(is_home=False)
    )
    row.is_home = True


def _visible(session, dashboard_id: Any, principal) -> Dashboard:
    identifier = parse_uuid(dashboard_id, field="dashboard_id")
    row = session.scalars(
        select(Dashboard)
        .options(selectinload(Dashboard.owner), selectinload(Dashboard.widgets))
        .where(
            Dashboard.id == identifier,
            Dashboard.deleted_at.is_(None),
            sharing.visibility(Dashboard, KIND, principal),
        )
    ).unique().first()
    if row is None:
        # The same answer as "you may not see it": whether somebody else's
        # private dashboard exists is itself information (§76).
        raise NotFoundError("That dashboard does not exist.", details={"id": str(identifier)})
    return row


def _owned(session, dashboard_id: Any, principal) -> Dashboard:
    row = _visible(session, dashboard_id, principal)
    sharing.require_owner(row, principal, kind=KIND)
    return row


def _widget_of(row: Dashboard, widget_id: Any) -> DashboardWidget:
    identifier = str(parse_uuid(widget_id, field="widget_id"))
    for widget in row.widgets:
        if str(widget.id) == identifier:
            return widget
    raise NotFoundError(
        "That widget is not on this dashboard.",
        details={"widget_id": identifier, "dashboard": str(row.id)},
    )


def _slug(name: str) -> str:
    cleaned = "".join(character if character.isalnum() else "-" for character in name.lower())
    return "-".join(part for part in cleaned.split("-") if part)[:120] or "dashboard"


def _serialize(session, row: Dashboard, principal, *, widgets: bool = True) -> dict[str, Any]:
    owner = row.owner
    can_edit = row.owner_id == principal.user_id and principal.can(MANAGE_PERMISSION)
    out: dict[str, Any] = {
        "id": str(row.id),
        "name": row.name,
        "slug": row.slug,
        "description": row.description,
        "scope": row.scope,
        "icon": row.icon,
        # *This reader's* home, not the owner's (§67). The column records a
        # preference belonging to whoever owns the dashboard, and publishing it
        # raw put a home marker on a colleague's public dashboard — which told
        # the reader something false about their own settings.
        "is_home": bool(row.is_home) and row.owner_id == principal.user_id,
        "is_default": bool(row.is_default),
        "columns": row.columns or COLUMNS,
        "filters": row.filters or {},
        "owner": {
            "id": str(owner.id) if owner else "",
            "name": owner.full_name if owner else "",
            "email": owner.email if owner else None,
        },
        "can_edit": can_edit,
        "members": sharing.members(session, KIND, row.id) if can_edit else [],
        "widget_count": len(row.widgets),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
    if widgets:
        out["widgets"] = [_widget(widget) for widget in sorted(
            row.widgets, key=lambda item: (item.position, item.y, item.x)
        )]
    return out


def _widget(row: DashboardWidget) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "kind": row.kind,
        "title": row.title,
        "subtitle": row.subtitle,
        "x": row.x,
        "y": row.y,
        "width": row.width,
        "height": row.height,
        "position": row.position,
        "config": row.config or {},
    }


def _state(row: Dashboard) -> dict[str, Any]:
    return {
        "name": row.name,
        "scope": row.scope,
        "is_home": bool(row.is_home),
        "columns": row.columns,
        "widgets": len(row.widgets),
    }
