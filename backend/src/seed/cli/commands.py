"""The repair commands, in the order `main` tries them: the first whose flag is set runs."""

from __future__ import annotations

from typing import Callable

from src.seed.cli import repairs_1, repairs_2, repairs_3

#: (flags, command): a command runs when any of its flags is set.
COMMANDS: tuple[tuple[tuple[str, ...], Callable[..., int]], ...] = (
    (('sync_schema',), repairs_1.sync_schema),
    (('sync_analytics',), repairs_1.sync_analytics),
    (('sync_workflows',), repairs_1.sync_workflows),
    (('sync_developers',), repairs_1.sync_developers),
    (('sync_onboarding',), repairs_1.sync_onboarding),
    (('sync_planning',), repairs_1.sync_planning),
    (('sync_approvals', 'sync_time', 'sync_sla', 'sync_forms'), repairs_1.sync_approvals),
    (('sync_files',), repairs_1.sync_files),
    (('sync_exports',), repairs_1.sync_exports),
    (('sync_imports',), repairs_1.sync_imports),
    (('sync_favorites',), repairs_2.sync_favorites),
    (('sync_tags',), repairs_2.sync_tags),
    (('sync_searches',), repairs_2.sync_searches),
    (('sync_sessions',), repairs_2.sync_sessions),
    (('sync_roles',), repairs_2.sync_roles),
    (('sync_reports',), repairs_2.sync_reports),
    (('sync_automations',), repairs_2.sync_automations),
    (('sync_mailboxes',), repairs_2.sync_mailboxes),
    (('sync_org',), repairs_2.sync_org),
    (('sync_flags', 'reset_flags'), repairs_2.sync_flags),
    (('sync_activity',), repairs_2.sync_activity),
    (('sync_preferences',), repairs_3.sync_preferences),
    (('sync_dashboards',), repairs_3.sync_dashboards),
    (('sync_report_documents',), repairs_3.sync_report_documents),
    (('sync_folders',), repairs_3.sync_folders),
    (('sync_insights',), repairs_3.sync_insights),
    (('sync_knowledge',), repairs_3.sync_knowledge),
    (('sync_assistant',), repairs_3.sync_assistant),
    (('sync_collab',), repairs_3.sync_collab),
    (('sync_health',), repairs_3.sync_health),
    (('sync_jobs',), repairs_3.sync_jobs),
    (('sync_settings',), repairs_3.sync_settings),
)
