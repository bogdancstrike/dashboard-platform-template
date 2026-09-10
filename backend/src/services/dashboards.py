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
    # A chart with the *whole* vocabulary rather than five fixed shapes: the
    # picture is part of the configuration, so a widget can be a treemap or a
    # scatter without a widget kind per drawing.
    "CHART",
    # The metric strip the analytics workspace opens with — several declared
    # numbers rather than one, which is what a dataset's headline actually is.
    "ANALYTICS",
    "MAP",
    # The two that put something the reader *already made* on the grid, rather
    # than asking them to describe it again. A chart composed in the chart
    # builder is a saved report; a question composed in the explorer is a saved
    # search. Both are shared, audited and permission-checked already, so a
    # widget that points at one inherits all of that instead of copying it.
    "REPORT",
    "SEARCH",
    # ── modules ──────────────────────────────────────────────────────────
    # A dashboard whose widgets are only charts is a reporting page. These put
    # the *product* on the grid: the work waiting in Tasks, the unread thread
    # in Mail, what lands in the calendar this week. Each is answered by the
    # module's own endpoint under the module's own permission, so a widget is
    # a window onto a page rather than a second implementation of it.
    "TASKS",
    "MAIL",
    "FILES",
    "NOTIFICATIONS",
    "PROJECTS",
    "ANNOUNCEMENTS",
    "EXPLORER",
    "RELATIONSHIPS",
    "FAVORITES",
    "CALENDAR",
})

#: Widgets that are a window onto a module rather than a question about a
#: dataset. They name no entity — the module decides what it is about — and
#: each is gated on the permission that gates the page it mirrors, so the
#: builder never offers a card that could only ever say "forbidden".
#:
#: A kind mapped to `None` needs nothing beyond being signed in, which is the
#: same rule its page uses: your own notifications and your own bookmarks are
#: facts about *you*.
MODULE_PERMISSIONS: dict[str, str | None] = {
    "TASKS": "tasks.view",
    "MAIL": "mail.access",
    "FILES": "files.view",
    "NOTIFICATIONS": None,
    "PROJECTS": "records.view",
    "ANNOUNCEMENTS": None,
    "EXPLORER": "records.view",
    "RELATIONSHIPS": "records.view",
    "FAVORITES": None,
    "CALENDAR": "calendar.view",
}

MODULE_KINDS = frozenset(MODULE_PERMISSIONS)

#: What each module widget may be told, and how to read it. Anything else the
#: caller sends is dropped rather than stored: a config that accumulates keys
#: nothing reads is a config nobody can later reason about.
#:
#: `"flag"` is a boolean, `"text"` a short string, `"count"` a small positive
#: number, `"id"` a UUID. Shallow on purpose — the module's own endpoint is
#: what actually answers the question, and re-deriving its vocabulary here
#: would be a second copy of it.
MODULE_OPTIONS: dict[str, dict[str, str]] = {
    "TASKS": {"board_id": "id", "mine": "flag", "status": "text"},
    "MAIL": {"folder": "text", "unread_only": "flag"},
    "FILES": {"folder_id": "id", "mine": "flag"},
    "NOTIFICATIONS": {"unread_only": "flag", "category": "text"},
    "PROJECTS": {"status": "text", "mine": "flag"},
    "ANNOUNCEMENTS": {"category": "text"},
    "EXPLORER": {"entity": "text"},
    "RELATIONSHIPS": {"entity": "text"},
    "FAVORITES": {"view": "text"},
    "CALENDAR": {"days": "count"},
}

#: Kinds that read a dataset directly. The platform-wide feeds name no entity,
#: the modules take their subject from the module, and the two that reference a
#: saved thing take their dataset from it — so the entity is required of these
#: rather than of all of them.
DATASET_KINDS = WIDGET_KINDS - {"ACTIVITY", "ALERTS", "REPORT", "SEARCH"} - MODULE_KINDS

#: What each referencing kind must name, and where that thing lives.
REFERENCE_KINDS: dict[str, tuple[str, str]] = {
    "REPORT": ("report_id", "report"),
    "SEARCH": ("search_id", "saved search"),
}

#: The widest a dashboard may be. Twelve is the grid every layout in the
#: product is built on; anything else would need a second set of breakpoints.
COLUMNS = 12

#: A widget shorter than this is a title with no room for an answer.
MIN_HEIGHT = 1
MAX_HEIGHT = 8

#: More than this at once is not a dashboard, it is a wall.
MAX_WIDGETS_AT_ONCE = 24

#: The size each kind wants when nobody has said. Declared beside the kinds
#: rather than in the page, so a dashboard created through the API is laid out
#: the same way as one created through the builder.
DEFAULT_SIZES: dict[str, tuple[int, int]] = {
    "KPI": (3, 1),
    "GAUGE": (3, 2),
    "LINE_CHART": (6, 2),
    "AREA_CHART": (6, 2),
    "BAR_CHART": (6, 2),
    "PIE_CHART": (4, 2),
    "HEATMAP": (6, 2),
    "CHART": (6, 2),
    "ANALYTICS": (6, 1),
    "MAP": (6, 3),
    "LIST": (4, 2),
    "TABLE": (6, 2),
    "ALERTS": (4, 2),
    "ACTIVITY": (4, 2),
    "REPORT": (6, 2),
    "SEARCH": (4, 2),
    # The modules. Wider than a chart where the content is rows of text, and
    # taller where it is a feed somebody scans rather than a number they read.
    "TASKS": (6, 3),
    "MAIL": (4, 3),
    "FILES": (4, 2),
    "NOTIFICATIONS": (4, 2),
    "PROJECTS": (6, 3),
    "ANNOUNCEMENTS": (4, 2),
    "EXPLORER": (4, 2),
    "RELATIONSHIPS": (4, 2),
    "FAVORITES": (3, 2),
    "CALENDAR": (4, 3),
}

#: What a widget is called when the caller did not say. A card headed "KPI"
#: tells a reader the shape and not the subject.
_TITLES: dict[str, str] = {
    "KPI": "Headline number",
    "GAUGE": "Gauge",
    "LINE_CHART": "Over time",
    "AREA_CHART": "Over time",
    "BAR_CHART": "Comparison",
    "PIE_CHART": "Share of the whole",
    "HEATMAP": "Where it concentrates",
    "CHART": "A chart",
    "ANALYTICS": "The headline numbers",
    "MAP": "Where it is",
    "LIST": "Newest records",
    "TABLE": "Records",
    "ALERTS": "What needs attention",
    "ACTIVITY": "Recent activity",
    "REPORT": "A saved report",
    "SEARCH": "A saved search",
    "TASKS": "Work in progress",
    "MAIL": "Mail",
    "FILES": "Recent files",
    "NOTIFICATIONS": "Notifications",
    "PROJECTS": "Projects",
    "ANNOUNCEMENTS": "Announcements",
    "EXPLORER": "Saved searches",
    "RELATIONSHIPS": "Most connected",
    "FAVORITES": "Favourites",
    "CALENDAR": "What is coming up",
}


def _default_title(kind: str) -> str:
    return _TITLES.get(kind, kind.replace("_", " ").title())


def _offerable(principal) -> set[str]:
    """The kinds a builder may put in front of *this* reader.

    Every kind but the modules is answered by an endpoint this one already
    required `records.view` for. The modules are windows onto other pages, and
    a window onto a page you may not open is a card that says forbidden
    forever — so they are filtered out here rather than refused later.
    """
    return {
        kind
        for kind in WIDGET_KINDS
        if kind not in MODULE_PERMISSIONS
        or MODULE_PERMISSIONS[kind] is None
        or principal.can(MODULE_PERMISSIONS[kind])
    }


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
        # Only the kinds this reader could actually see answered. A module
        # widget is gated on the permission that gates the page it mirrors, so
        # somebody without `mail.access` is not offered a Mail card that would
        # draw a 403 the moment it landed on the grid (§76).
        "widget_kinds": sorted(_offerable(principal)),
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
    """A dashboard, and whatever it was asked to start with.

    Widgets arrive with it rather than one request at a time, because a
    dashboard is created *in order to hold* something: an empty one is a thing
    somebody then has to furnish, and a create flow that ends on an empty grid
    has stopped one step short. They are laid out here by the same rule the
    grid's own compaction uses, so the result is tidy without anybody dragging.
    """
    principal.require(MANAGE_PERMISSION)
    values = _validated(payload, principal=principal, partial=False)
    members = values.pop("member_ids")
    home = values.pop("is_home", False)
    wanted = _requested_widgets(payload, principal=principal)

    row = Dashboard(
        owner_id=principal.user_id,
        organization_id=principal.organization_id,
        slug=_slug(values["name"]),
        **values,
    )
    session.add(row)
    session.flush()
    for position, widget in enumerate(wanted):
        row.widgets.append(DashboardWidget(position=position, **widget))
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

    out.update(
        _geometry(payload, columns=columns, existing=existing, partial=partial, kind=kind)
    )
    return out


def _config(raw: Any, *, kind: str, principal) -> dict[str, Any]:
    """What the widget asks, checked against what may actually be asked.

    **An unconfigured widget is a legitimate state, not an error.** The create
    flow picks *shapes* — four headline numbers, an alert strip, a bar chart —
    and each is filled in afterwards on the grid it will live on. Requiring a
    dataset up front would mean choosing thirteen datasets in a modal before
    seeing a single card, which is the flow this one exists to replace. So what
    is validated is that whatever *is* named can actually be asked for; the
    widget itself says, in place, that it still needs a subject (§34).

    Deliberately shallow beyond that: the question is executed by the endpoint
    that owns it, and re-deriving which fields are groupable would be a second
    copy of the analysis catalogue.
    """
    config = dict(raw or {})
    entity = str(config.get("entity") or "").strip()

    if kind in MODULE_KINDS:
        # A module widget is checked here as well as when it is drawn: a
        # dashboard shared with somebody who lacks `mail.access` still holds
        # the card, and its body says so — but *adding* one you could never
        # see is a mistake worth refusing at the point it is made.
        needed = MODULE_PERMISSIONS.get(kind)
        if needed and not principal.can(needed):
            raise ValidationError(
                "That module is not one your role can open.",
                details={"kind": kind, "permission": needed},
            )
        return _module_options(config, kind=kind, principal=principal)

    if kind in REFERENCE_KINDS:
        key, noun = REFERENCE_KINDS[kind]
        reference = str(config.get(key) or "").strip()
        if reference:
            # Parsed, not resolved: whether the reader may *see* that report is
            # decided when the widget is drawn, by the endpoint that owns it. A
            # check here would go stale the moment the owner changed its
            # audience.
            config[key] = str(parse_uuid(reference, field=key))
        else:
            config.pop(key, None)
        if entity:
            raise ValidationError(
                f"That widget takes its dataset from the saved {noun} it names.",
                details={"kind": kind, "entity": entity},
            )
        return config

    if kind in DATASET_KINDS:
        if entity:
            # Checked against the reader's own permissions: a widget pointing
            # at a dataset they may not read would be a card that always says
            # forbidden.
            resource_for(entity, principal=principal)
            config["entity"] = entity
        else:
            config.pop("entity", None)
    elif entity:
        raise ValidationError(
            "That widget is a platform-wide feed and names no dataset.",
            details={"kind": kind, "entity": entity},
        )

    filters = config.get("filters")
    if filters is not None and not isinstance(filters, dict):
        raise ValidationError("config.filters must be an object.")

    return config


def _module_options(config: dict[str, Any], *, kind: str, principal) -> dict[str, Any]:
    """What a module widget was told, keeping only what that module reads.

    Unknown keys are dropped rather than refused. A config is a place a client
    would otherwise accumulate scratch state, and a stored key nothing reads is
    a key somebody later has to work out the meaning of; but refusing the whole
    write over one stray field would make every client upgrade a breaking
    change.
    """
    declared = MODULE_OPTIONS.get(kind, {})
    out: dict[str, Any] = {}
    for key, shape in declared.items():
        if key not in config or config[key] in (None, ""):
            continue
        value = config[key]
        if shape == "flag":
            out[key] = bool(value)
        elif shape == "count":
            try:
                out[key] = max(1, min(365, int(value)))
            except (TypeError, ValueError) as exc:
                raise ValidationError(f"config.{key} must be a whole number.") from exc
        elif shape == "id":
            out[key] = str(parse_uuid(value, field=key))
        else:
            text = str(value).strip()[:120]
            # An `entity` on a module widget names which dataset the module is
            # pointed at — the explorer's saved searches for one resource, a
            # relationship map rooted in one — so it is checked against the
            # reader's own permissions exactly as a chart's dataset is.
            if key == "entity":
                resource_for(text, principal=principal)
            out[key] = text
    return out


def _geometry(
    payload: dict[str, Any],
    *,
    columns: int,
    existing: DashboardWidget | None = None,
    partial: bool = True,
    kind: str = "",
) -> dict[str, Any]:
    """Where the card sits, checked so a grid cannot render on top of itself.

    A size the caller did not give comes from the *kind*, which is the one
    place that knows a KPI wants three columns and a heatmap wants six. A
    client that had to send sizes would be a second copy of that table.
    """
    out: dict[str, Any] = {}
    default_width, default_height = DEFAULT_SIZES.get(kind, (4, 2))

    def number(key: str, default: int) -> int:
        if key in payload:
            try:
                return int(payload[key])
            except (TypeError, ValueError) as exc:
                raise ValidationError(f"{key} must be a whole number.") from exc
        if existing is not None:
            return int(getattr(existing, key))
        return default

    width = number("width", default_width)
    height = number("height", default_height)
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
        # *What* it holds, not only how much — a card in a gallery has room for
        # the kinds and a reader recognises "alerts, revenue, a heatmap" far
        # faster than "7 widgets".
        "widget_kinds": sorted({widget.kind for widget in row.widgets}),
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
