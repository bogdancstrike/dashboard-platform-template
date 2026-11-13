"""Seed data for operations: _audit_and_activity, _health_series."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from src.seed import catalog
from src.seed.operations.integrations import _change_for
from src.seed.operations.scheduled_tasks import AUDIT_ACTIONS, _role_code
from src.seed.world import World


def _health_series(rng, anchor) -> list[dict[str, Any]]:
    """One service's month, coarse at the far end and hourly at the near one.

    Incidents come in *runs* rather than as independent draws, because that is
    what an outage is: a service that flickers unhealthy for one isolated hour
    every day is a pattern no real dependency has, and a page drawn from it
    teaches somebody to read noise.
    """
    points: list[dict[str, Any]] = []
    # Four-hourly from 30 days back to 2 days back, then hourly to now.
    steps = [(hours, 4) for hours in range(30 * 24, 48, -4)]
    steps += [(hours, 1) for hours in range(48, -1, -1)]

    # How many more points the current incident has left to run.
    remaining = 0
    status = "HEALTHY"
    for hours, _width in steps:
        if remaining > 0:
            remaining -= 1
        elif rng.chance(0.04):
            status = rng.weighted((("DEGRADED", 0.75), ("UNAVAILABLE", 0.25)))
            remaining = rng.integer(1, 5)
        else:
            status = "HEALTHY"
        points.append({
            "at": (anchor - timedelta(hours=hours)).isoformat(),
            # A degraded service is slow, which is usually how it is noticed.
            "latency_ms": float(
                rng.decimal(0.5, 60) if status == "HEALTHY" else rng.decimal(120, 900)
            ),
            "status": status,
        })
    return points


def _audit_and_activity(world: World) -> None:
    """One audit row and, usually, one activity entry per event.

    They answer different questions with different lifetimes — forensic versus
    contextual — which is why `core/audit.py` writes both from a single call
    and why the seed does the same.
    """
    from src.core.audit import _activity_kind, _summarise, diff
    from src.models.platform import ActivityEntry, AuditLog

    rng = world.rng.derive("audit")
    if not world.users:
        return

    # Grouped by dataset rather than pooled, because of *how* one is chosen
    # below. A single flat list picked from uniformly picks a dataset in
    # proportion to how many records it has — eight hundred orders against
    # fifty projects means a project is the subject of one event in forty, and
    # after the feed is scoped to an organization there are demo accounts whose
    # project filter matches nothing at all. A feed exists to be filtered, and
    # a filter that can only be demonstrated on some datasets demonstrates the
    # wrong thing.
    by_dataset: dict[str, list[tuple[str, object, str, object]]] = {}

    def offer(kind: str, rows, label) -> None:
        entries = [(kind, row.id, label(row), row.organization_id) for row in rows]
        if entries:
            by_dataset[kind] = entries

    offer("project", world.projects, lambda row: row.name)
    offer("task", world.tasks, lambda row: row.title)
    offer("ticket", world.tickets, lambda row: row.subject)
    offer("order", world.orders, lambda row: row.reference)
    offer("customer", world.customers, lambda row: row.name)
    offer("user", world.users, lambda row: row.full_name)
    if not by_dataset:
        return
    datasets = sorted(by_dataset)

    projects_by_org: dict = {}
    for project in world.projects:
        projects_by_org.setdefault(project.organization_id, []).append(project)

    for _ in range(world.scale.audit_logs):
        actor = rng.pick(world.users)
        action = rng.weighted(AUDIT_ACTIONS)
        # The dataset first, then a record in it: every dataset gets roughly
        # the same share of the history, whatever its volume.
        resource_type, resource_id, label, organization_id = rng.pick(
            by_dataset[rng.pick(datasets)]
        )
        occurred = rng.past_business_hour(rng.recent(days=180))
        result = rng.weighted((("SUCCESS", 0.9), ("FAILURE", 0.05), ("DENIED", 0.04), ("PARTIAL", 0.01)))

        before, after = _change_for(rng, action, resource_type)
        changes = diff(before, after)
        impersonated = action == "IMPERSONATE" or rng.chance(0.02)
        # An impersonated row carries both identities, so the explorer has
        # something real to render for the case §21 cares most about.
        impersonator = rng.pick(list(world.personas.values()) or world.users) if impersonated else None

        world.audit_logs.append(
            AuditLog(
                id=rng.uuid(),
                occurred_at=occurred,
                action=action,
                resource_type=resource_type,
                resource_id=str(resource_id),
                resource_label=str(label)[:255],
                actor_id=actor.id,
                actor_label=actor.full_name,
                actor_role=_role_code(world, actor),
                organization_id=organization_id,
                result=result,
                ip_address=f"{rng.integer(10, 213)}.{rng.integer(0, 255)}.{rng.integer(0, 255)}.{rng.integer(1, 254)}",
                user_agent=rng.pick(catalog.USER_AGENTS),
                correlation_id=rng.uuid().hex,
                message="" if result == "SUCCESS" else f"{action.lower()} refused",
                state_before=before or None,
                state_after=after or None,
                changed_fields=list(changes) or None,
                changes=changes or None,
                metadata_json={"source": rng.pick(("ui", "api", "job"))},
                impersonated=impersonated,
                impersonator_id=impersonator.id if impersonator else None,
                impersonator_label=impersonator.full_name if impersonator else None,
                created_at=occurred,
            )
        )

        if rng.chance(0.75):
            projects = projects_by_org.get(organization_id, [])
            world.activity_entries.append(
                ActivityEntry(
                    id=rng.uuid(),
                    occurred_at=occurred,
                    kind=_activity_kind(action),
                    action=action,
                    actor_id=actor.id,
                    actor_label=actor.full_name,
                    resource_type=resource_type,
                    resource_id=str(resource_id),
                    resource_label=str(label)[:255],
                    project_id=(
                        resource_id if resource_type == "project"
                        else (rng.pick(projects).id if projects and rng.chance(0.4) else None)
                    ),
                    organization_id=organization_id,
                    summary=_summarise(action, resource_type, str(label)),
                    metadata_json={"changed": list(changes)} if changes else None,
                    created_at=occurred,
                )
            )
