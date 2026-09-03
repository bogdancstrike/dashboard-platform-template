"""The dataset under construction, and how big it is.

Builders run in dependency order and hand each other rows through this object
rather than re-querying: a seed that reads back what it just wrote is a seed
that spends most of its time in the database, and referential consistency
becomes something you hope for rather than something you hold.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from src.seed.support import Rng


@dataclass(frozen=True, slots=True)
class Scale:
    """How many of each thing. `small` exists so iterating on the seed itself
    does not cost a minute per run."""

    name: str
    organizations: int
    departments_per_org: tuple[int, int]
    teams_per_org: tuple[int, int]
    users: int
    sessions: int
    login_events: int
    security_events: int
    customers: int
    projects: int
    tasks: int
    tickets: int
    orders: int
    devices: int
    calendar_events: int
    folders: int
    files: int
    email_threads: int
    email_messages: int
    comments: int
    tag_links: int
    audit_logs: int
    system_logs: int
    notifications: int
    background_jobs: int
    api_request_logs: int
    import_runs: int
    saved_searches: int
    saved_views: int
    favorites: int
    recent_items: int
    dashboards: int
    reports: int


FULL = Scale(
    name="full",
    organizations=20,
    departments_per_org=(4, 8),
    teams_per_org=(3, 8),
    users=150,
    sessions=200,
    login_events=800,
    security_events=120,
    customers=300,
    projects=50,
    tasks=500,
    tickets=600,
    orders=800,
    devices=250,
    calendar_events=400,
    folders=60,
    files=100,
    email_threads=80,
    email_messages=200,
    comments=800,
    tag_links=1200,
    audit_logs=1000,
    system_logs=2000,
    notifications=500,
    background_jobs=100,
    api_request_logs=2000,
    import_runs=10,
    saved_searches=60,
    saved_views=40,
    favorites=250,
    recent_items=450,
    dashboards=30,
    reports=40,
)

SMALL = Scale(
    name="small",
    organizations=4,
    departments_per_org=(2, 4),
    teams_per_org=(1, 3),
    users=25,
    sessions=20,
    login_events=60,
    security_events=15,
    customers=30,
    projects=8,
    tasks=60,
    tickets=50,
    orders=60,
    devices=25,
    calendar_events=40,
    folders=12,
    files=20,
    email_threads=10,
    email_messages=25,
    comments=60,
    tag_links=100,
    audit_logs=120,
    system_logs=200,
    notifications=50,
    background_jobs=15,
    api_request_logs=150,
    import_runs=4,
    saved_searches=10,
    saved_views=8,
    favorites=30,
    recent_items=50,
    dashboards=6,
    reports=8,
)

SCALES: dict[str, Scale] = {FULL.name: FULL, SMALL.name: SMALL}


@dataclass
class World:
    """Everything built so far, in insertion order per table."""

    rng: Rng
    scale: Scale
    anchor: datetime

    # identity
    regions: list[Any] = field(default_factory=list)
    roles: list[Any] = field(default_factory=list)
    organizations: list[Any] = field(default_factory=list)
    departments: list[Any] = field(default_factory=list)
    teams: list[Any] = field(default_factory=list)
    groups: list[Any] = field(default_factory=list)
    users: list[Any] = field(default_factory=list)
    sessions: list[Any] = field(default_factory=list)
    login_events: list[Any] = field(default_factory=list)
    security_events: list[Any] = field(default_factory=list)

    # business
    customers: list[Any] = field(default_factory=list)
    projects: list[Any] = field(default_factory=list)
    tasks: list[Any] = field(default_factory=list)
    tickets: list[Any] = field(default_factory=list)
    orders: list[Any] = field(default_factory=list)
    devices: list[Any] = field(default_factory=list)
    calendar_events: list[Any] = field(default_factory=list)

    # content
    folders: list[Any] = field(default_factory=list)
    files: list[Any] = field(default_factory=list)
    email_threads: list[Any] = field(default_factory=list)
    email_messages: list[Any] = field(default_factory=list)
    email_attachments: list[Any] = field(default_factory=list)
    email_templates: list[Any] = field(default_factory=list)
    comments: list[Any] = field(default_factory=list)
    tags: list[Any] = field(default_factory=list)
    tag_links: list[Any] = field(default_factory=list)

    # platform operations
    audit_logs: list[Any] = field(default_factory=list)
    activity_entries: list[Any] = field(default_factory=list)
    system_logs: list[Any] = field(default_factory=list)
    notifications: list[Any] = field(default_factory=list)
    background_jobs: list[Any] = field(default_factory=list)
    scheduled_tasks: list[Any] = field(default_factory=list)
    feature_flags: list[Any] = field(default_factory=list)
    api_clients: list[Any] = field(default_factory=list)
    api_credentials: list[Any] = field(default_factory=list)
    api_request_logs: list[Any] = field(default_factory=list)
    integrations: list[Any] = field(default_factory=list)
    alert_rules: list[Any] = field(default_factory=list)
    system_settings: list[Any] = field(default_factory=list)
    service_health: list[Any] = field(default_factory=list)
    import_runs: list[Any] = field(default_factory=list)

    # personalization
    saved_searches: list[Any] = field(default_factory=list)
    resource_shares: list[Any] = field(default_factory=list)
    saved_views: list[Any] = field(default_factory=list)
    favorites: list[Any] = field(default_factory=list)
    recent_items: list[Any] = field(default_factory=list)
    dashboards: list[Any] = field(default_factory=list)
    dashboard_widgets: list[Any] = field(default_factory=list)
    reports: list[Any] = field(default_factory=list)
    notification_preferences: list[Any] = field(default_factory=list)

    #: The five realm personas, by role code, so later builders can make sure
    #: the accounts a reviewer actually signs in as own interesting data.
    personas: dict[str, Any] = field(default_factory=dict)

    #: users grouped by organization id — every builder needs this.
    users_by_org: dict[Any, list[Any]] = field(default_factory=dict)

    def counts(self) -> dict[str, int]:
        return {
            name: len(value)
            for name, value in vars(self).items()
            if isinstance(value, list)
        }

    def total(self) -> int:
        return sum(self.counts().values())
