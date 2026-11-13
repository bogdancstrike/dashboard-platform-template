"""The widget kinds a dashboard offers, and which a reader may add."""

from __future__ import annotations

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
    # A saved insight (§43): the generated page, its numbers re-read for the
    # viewer each time the dashboard is drawn.
    "INSIGHT",
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
DATASET_KINDS = WIDGET_KINDS - {"ACTIVITY", "ALERTS", "REPORT", "SEARCH", "INSIGHT"} - MODULE_KINDS


#: What each referencing kind must name, and where that thing lives.
REFERENCE_KINDS: dict[str, tuple[str, str]] = {
    "REPORT": ("report_id", "report"),
    "SEARCH": ("search_id", "saved search"),
    "INSIGHT": ("insight_id", "insight"),
}


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
