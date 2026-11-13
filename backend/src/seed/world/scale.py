"""Seed data for world: Scale."""

from __future__ import annotations

from dataclasses import dataclass


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
    favorites: int
    recent_items: int
    dashboards: int
    reports: int
    announcements: int
    kanban_boards: int


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
    favorites=250,
    recent_items=450,
    dashboards=30,
    reports=40,
    announcements=14,
    kanban_boards=4,
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
    favorites=30,
    recent_items=50,
    dashboards=6,
    reports=8,
    announcements=6,
    kanban_boards=2,
)


SCALES: dict[str, Scale] = {FULL.name: FULL, SMALL.name: SMALL}
