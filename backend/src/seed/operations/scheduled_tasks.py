"""Seed data for operations: AUDIT_ACTIONS, _scheduled_tasks, _role_code."""

from __future__ import annotations

from src.seed import catalog
from src.seed.world import World

AUDIT_ACTIONS: tuple[tuple[str, float], ...] = (
    ("UPDATE", 0.3), ("CREATE", 0.2), ("VIEW", 0.12), ("DELETE", 0.06),
    ("EXPORT", 0.07), ("LOGIN", 0.09), ("STATUS_CHANGE", 0.05),
    ("PERMISSION_CHANGE", 0.03), ("BULK_UPDATE", 0.03), ("IMPORT", 0.02),
    ("CONFIGURATION_CHANGE", 0.02), ("IMPERSONATE", 0.01),
)


def _scheduled_tasks(world: World) -> None:
    from src.models.platform import ScheduledTask

    rng = world.rng.derive("scheduled")
    for code, name, cron, kind in catalog.SCHEDULED_TASKS:
        enabled = rng.chance(0.85)
        runs = rng.integer(20, 9_000)
        failures = rng.integer(0, max(1, runs // 40))
        world.scheduled_tasks.append(
            ScheduledTask(
                id=rng.uuid(),
                name=name,
                code=code,
                description=f"{name} — runs on `{cron}`.",
                cron=cron,
                timezone=rng.pick(("UTC", "Europe/Bucharest", "Europe/Amsterdam")),
                job_kind=kind,
                enabled=enabled,
                last_run_at=rng.recent(days=2) if enabled else rng.maybe(rng.ago(days_max=90), 0.6),
                last_status=rng.weighted((("SUCCEEDED", 0.84), ("FAILED", 0.1), ("RUNNING", 0.06))) if enabled else None,
                last_duration_ms=rng.integer(120, 400_000),
                next_run_at=rng.ahead(days_min=0, days_max=1) if enabled else None,
                run_count=runs,
                failure_count=failures,
                owner_id=rng.pick(world.users).id if world.users else None,
                payload={"kind": kind, "notify_on_failure": True},
                created_at=rng.ago(days_min=100, days_max=800),
            )
        )


def _role_code(world: World, user) -> str:
    for role in world.roles:
        if role.id == user.role_id:
            return role.code
    return "VIEWER"
