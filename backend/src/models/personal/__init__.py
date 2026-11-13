"""Personal and shared things: saved searches, reports, dashboards, favourites, sharing.

Every submodule is imported here: importing the package registers all its tables."""

from __future__ import annotations

from src.models.personal.dashboards import (  # noqa: F401
    Dashboard,
    DashboardWidget,
)
from src.models.personal.saved import (  # noqa: F401
    Report,
    ReportDocument,
    SavedSearch,
)
from src.models.personal.sharing import (  # noqa: F401
    MEMBER_SCOPES,
    SCOPES,
    Favorite,
    NotificationPreference,
    RecentItem,
    ResourceShare,
)
