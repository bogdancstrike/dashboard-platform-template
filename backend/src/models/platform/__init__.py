"""Platform tables: audit and logs, notifications, jobs, settings and integrations, API clients, alert rules.

Every submodule is imported here: importing the package registers all its tables."""

from __future__ import annotations

from src.models.platform.alerts import (  # noqa: F401
    AlertRule,
    AlertRuleFire,
    AlertRuleRun,
)
from src.models.platform.api_clients import (  # noqa: F401
    ApiClient,
    ApiCredential,
    ApiRequestLog,
)
from src.models.platform.audit import (  # noqa: F401
    ActivityEntry,
    AuditLog,
    SystemLog,
)
from src.models.platform.configuration import (  # noqa: F401
    FeatureFlag,
    Integration,
    ServiceHealth,
    SystemSetting,
)
from src.models.platform.jobs import (  # noqa: F401
    BackgroundJob,
    ImportRun,
    ScheduledTask,
)
from src.models.platform.notices import (  # noqa: F401
    Announcement,
    AnnouncementReceipt,
    Notification,
)
