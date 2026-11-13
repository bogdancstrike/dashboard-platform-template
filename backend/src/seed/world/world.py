"""Seed data for world: World."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from src.seed.support import Rng
from src.seed.world.scale import Scale


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
    announcements: list[Any] = field(default_factory=list)
    announcement_receipts: list[Any] = field(default_factory=list)
    kanban_boards: list[Any] = field(default_factory=list)
    kanban_lanes: list[Any] = field(default_factory=list)
    kanban_cards: list[Any] = field(default_factory=list)
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
