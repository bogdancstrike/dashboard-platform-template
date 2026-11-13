"""Seed data for operations: build."""

from __future__ import annotations

from src.core import vocabulary
from src.seed import catalog
from src.seed.operations.alert_rules import (
    GUARANTEED_PER_STATUS,
    _alert_rules,
    _api_request_logs,
)
from src.seed.operations.announcements import _announcements
from src.seed.operations.api_clients import _api_clients, _service_health
from src.seed.operations.audit_and_activity import _audit_and_activity
from src.seed.operations.background_jobs import background_job
from src.seed.operations.import_runs import _import_runs
from src.seed.operations.integrations import _integrations
from src.seed.operations.notification_for import _feature_flags, _notifications
from src.seed.operations.scheduled_tasks import _scheduled_tasks
from src.seed.operations.system_logs import _system_logs, _system_settings
from src.seed.world import World


def build(world: World) -> None:
    _system_settings(world)
    _service_health(world)
    _feature_flags(world)
    _integrations(world)
    _scheduled_tasks(world)
    _background_jobs(world)
    _api_clients(world)
    _api_request_logs(world)
    _alert_rules(world)
    _import_runs(world)
    _audit_and_activity(world)
    _system_logs(world)
    _notifications(world)
    _announcements(world)


def _background_jobs(world: World) -> None:
    rng = world.rng.derive("jobs")
    drawn = world.scale.background_jobs

    for index in range(drawn):
        world.background_jobs.append(
            background_job(
                rng,
                index=index,
                status=rng.weighted(catalog.JOB_STATUSES),
                users=world.users,
                scheduled_tasks=world.scheduled_tasks,
            )
        )

    # Then top every status up to the guaranteed minimum, so each filter the
    # console offers can match something and the suite that consumes them has
    # room to run more than once.
    from collections import Counter

    # Counted on jobs that can still be *acted on*, not merely on rows: the
    # draw produces a job born at attempt 3 of 3 about seven times in a
    # hundred, and one of those satisfies a filter while satisfying nothing
    # else. Same invariant `sync_jobs` repairs to.
    counted = Counter(
        job.status
        for job in world.background_jobs
        if job.attempt < job.max_attempts
    )
    offset = 0
    for status in vocabulary.JOB_STATUS:
        for _ in range(max(0, GUARANTEED_PER_STATUS - counted[status])):
            world.background_jobs.append(
                background_job(
                    rng,
                    index=drawn + offset,
                    status=status,
                    users=world.users,
                    scheduled_tasks=world.scheduled_tasks,
                    fresh=True,
                )
            )
            offset += 1
