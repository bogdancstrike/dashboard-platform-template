"""Seed data for operations: _notification_for, _notifications, _feature_flags."""

from __future__ import annotations

from src.seed import catalog
from src.seed.world import World


def _feature_flags(world: World) -> None:
    from src.models.platform import FeatureFlag

    rng = world.rng.derive("flags")
    admins = [u for u in world.users if u.id in {p.id for p in world.personas.values()}]

    from src.core.feature_catalogue import FEATURES

    # Every flag is seeded at its catalogue default — on at a hundred per cent
    # for a shipped feature. A rollout percentage is how a team ships
    # something gradually, and applying one at random to a finished feature
    # means a dice roll decides whether a page exists — which is exactly what
    # happened to `/dashboards` (§27).
    for feature in FEATURES:
        world.feature_flags.append(
            FeatureFlag(
                id=rng.uuid(),
                key=feature.key,
                name=feature.name,
                description=feature.description,
                enabled=feature.default_on,
                environment="production",
                stage=feature.stage,
                rollout_percentage=feature.default_rollout,
                target_user_ids=None,
                target_roles=None,
                owner_id=rng.pick(admins).id if admins else None,
                updated_by_id=rng.pick(admins).id if admins else None,
                last_toggled_at=rng.maybe(rng.recent(days=60), 0.7),
                experimental=feature.experimental,
                created_at=rng.ago(days_min=30, days_max=600),
            )
        )


def _notifications(world: World) -> None:
    from src.models.platform import Notification

    rng = world.rng.derive("notifications")
    if not world.users:
        return

    #: Personas get most of the notifications — a bell with nothing behind it
    #: demonstrates nothing.
    recipients = list(world.personas.values()) * 3 + world.users

    for _ in range(world.scale.notifications):
        user = rng.pick(recipients)
        category = rng.pick(catalog.NOTIFICATION_CATEGORIES)
        actor = rng.pick(world.users)
        created = rng.recent(days=30)
        read = rng.chance(0.55)

        title, body, link, resource_type, resource_id = _notification_for(rng, world, category, actor)
        world.notifications.append(
            Notification(
                id=rng.uuid(),
                user_id=user.id,
                category=category,
                severity=rng.weighted(catalog.NOTIFICATION_SEVERITIES),
                title=title,
                body=body,
                icon=catalog.NOTIFICATION_ICONS[category],
                is_read=read,
                read_at=rng.between(created, world.anchor) if read else None,
                link=link,
                resource_type=resource_type,
                resource_id=str(resource_id) if resource_id else None,
                actor_id=actor.id,
                actor_label=actor.full_name,
                # Grouping key so twelve "assigned you a task" notifications
                # collapse into one row instead of burying everything else.
                group_key=f"{category.lower()}:{resource_type or 'system'}",
                created_at=created,
            )
        )


def _notification_for(rng, world: World, category: str, actor):
    if category == "ASSIGNMENT" and world.tasks:
        task = rng.pick(world.tasks)
        return (
            f"{actor.full_name} assigned you {task.reference}",
            task.title,
            f"/tasks/{task.id}",
            "task",
            task.id,
        )
    if category == "MENTION" and world.projects:
        project = rng.pick(world.projects)
        return (
            f"{actor.full_name} mentioned you",
            f"in a comment on {project.name}",
            f"/projects/{project.id}",
            "project",
            project.id,
        )
    if category == "APPROVAL" and world.orders:
        order = rng.pick(world.orders)
        return (
            f"Approval requested for {order.reference}",
            f"{order.total} {order.currency} — awaiting your sign-off",
            f"/orders/{order.id}",
            "order",
            order.id,
        )
    if category == "SECURITY":
        return (
            "New sign-in from an unrecognised device",
            "If this was not you, revoke the session from your security settings.",
            "/settings/security",
            "user",
            actor.id,
        )
    if category == "ALERT" and world.alert_rules:
        rule = rng.pick(world.alert_rules)
        return (
            f"{rule.name} fired",
            "An automation matched something worth telling you about.",
            "/workflows",
            "alert_rule",
            rule.id,
        )
    if category == "REPORT" and world.background_jobs:
        job = rng.pick(world.background_jobs)
        return (
            f"{job.name} is ready",
            f"{job.processed_units} rows exported",
            f"/jobs/{job.id}",
            "job",
            job.id,
        )
    return (
        "Scheduled maintenance this weekend",
        "The platform will be read-only between 22:00 and 02:00 on Saturday.",
        "/system/health",
        None,
        None,
    )
