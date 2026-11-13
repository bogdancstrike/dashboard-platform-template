"""The business records: customers, orders, tickets, projects, tasks, devices, events.

Every submodule is imported here: importing the package registers all its tables."""

from __future__ import annotations

from src.models.business.crm import (  # noqa: F401
    Customer,
    Order,
    Ticket,
)
from src.models.business.devices import (  # noqa: F401
    Device,
)
from src.models.business.work import (  # noqa: F401
    CalendarEvent,
    Project,
    Task,
)
