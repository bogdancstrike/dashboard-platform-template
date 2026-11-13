"""The grid, and a widget's default size and title."""

from __future__ import annotations

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
    "INSIGHT": (6, 4),
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
    "INSIGHT": "An insight",
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
