"""Seed data for operations: _system_settings, _system_logs."""

from __future__ import annotations

from src.seed import catalog
from src.seed.support import reference
from src.seed.world import World


def _system_settings(world: World) -> None:
    from src.models.platform import SystemSetting

    rng = world.rng.derive("settings")
    admin = world.personas.get("ADMINISTRATOR")

    for key, category, label, value_type, default, description, options in catalog.SYSTEM_SETTINGS:
        # Most settings sit at their default; a handful are overridden, which is
        # what gives the settings screen something to show as "changed".
        overridden = rng.chance(0.28)
        value = default
        if overridden:
            if value_type == "boolean":
                value = not default
            elif value_type in ("integer", "duration"):
                # Within the declared range, so an overridden value is one the
                # form would accept — a seeded setting the editor refuses is a
                # screen that reports its own data as invalid.
                low = int(options.get("minimum", 1))
                high = int(options.get("maximum", max(int(default) * 3, low + 1)))
                value = min(max(int(int(default) * rng.pick((0.5, 2, 3))), low), high)
            elif value_type == "choice":
                choices = [item for item in options.get("choices", []) if item != default]
                value = rng.pick(choices) if choices else default
            else:
                value = f"{default}"
        world.system_settings.append(
            SystemSetting(
                id=rng.uuid(),
                key=key,
                category=category,
                label=label,
                description=description,
                value={"value": value},
                default_value={"value": default},
                value_type=value_type,
                # The declaration itself, so the form renders from it. A
                # boolean needs none — a switch has no choices and no range.
                options=options or None,
                # Declared in the catalogue, so the one secret in the demo is
                # the one the settings screen redacts.
                is_secret=bool(options.get("secret")),
                requires_restart=bool(options.get("restart")),
                updated_by_id=admin.id if admin and overridden else None,
                created_at=rng.ago(days_min=200, days_max=800),
            )
        )


def _system_logs(world: World) -> None:
    from src.models.platform import SystemLog

    rng = world.rng.derive("logs")
    hosts = tuple(f"api-{index}" for index in range(1, 5))

    for _ in range(world.scale.system_logs):
        level = rng.weighted(catalog.LOG_LEVELS)
        template = rng.pick(catalog.LOG_MESSAGES[level])
        message = (
            template.replace("{ms}", str(rng.integer(1, 9_000)))
            .replace("{count}", str(rng.integer(1, 50_000)))
            .replace("{n}", str(rng.integer(1, 9)))
            .replace("{ip}", f"{rng.integer(10, 213)}.{rng.integer(0, 255)}.{rng.integer(0, 255)}.{rng.integer(1, 254)}")
            .replace("{key}", rng.pick(("advanced-search", "cli_9f2a", "dashboard-builder")))
            .replace("{ref}", reference("JOB", rng.integer(1, 500), width=6))
            .replace("{code}", rng.pick([task[0] for task in catalog.SCHEDULED_TASKS]))
            .replace("{path}", rng.pick(catalog.API_PATHS))
            .replace("{host}", rng.pick(hosts))
        )
        failed = level in ("ERROR", "CRITICAL")
        logged = rng.recent(days=10, bias=3.2)

        world.system_logs.append(
            SystemLog(
                id=rng.uuid(),
                logged_at=logged,
                level=level,
                service=rng.weighted((("platform-api", 0.78), ("platform-seed", 0.05), ("platform-jobs", 0.17))),
                logger=rng.pick(catalog.LOGGERS),
                message=message,
                correlation_id=rng.uuid().hex,
                trace_id=rng.uuid().hex,
                span_id=rng.uuid().hex[:16],
                user_id=rng.pick(world.users).id if world.users and rng.chance(0.55) else None,
                host=rng.pick(hosts),
                environment=rng.weighted((("production", 0.7), ("staging", 0.22), ("local", 0.08))),
                duration_ms=rng.decimal(0.4, 9_000) if rng.chance(0.6) else None,
                status_code=rng.weighted(((200, 0.7), (201, 0.05), (400, 0.06), (404, 0.06), (500, 0.13))) if rng.chance(0.6) else None,
                context={"module": rng.pick(catalog.LOGGERS), "attempt": rng.integer(1, 3)},
                stack_trace=(
                    'Traceback (most recent call last):\n'
                    '  File "src/api/entities.py", line 214, in list_records\n'
                    "    return envelope(items, total, page)\n"
                    "sqlalchemy.exc.OperationalError: statement timeout"
                ) if failed and rng.chance(0.55) else None,
            )
        )
