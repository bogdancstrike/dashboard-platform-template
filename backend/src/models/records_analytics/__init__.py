"""Records analytics tables: customer health, contracts, metric watches, public dashboard links.

Every submodule is imported here: importing the package registers all its tables."""

from __future__ import annotations

from src.models.records_analytics.contracts import (  # noqa: F401
    Contract,
)
from src.models.records_analytics.health import (  # noqa: F401
    CustomerHealth,
    CustomerHealthSnapshot,
    HealthModel,
)
from src.models.records_analytics.links import (  # noqa: F401
    DashboardLink,
)
from src.models.records_analytics.watches import (  # noqa: F401
    MetricAnomaly,
    MetricWatch,
)
