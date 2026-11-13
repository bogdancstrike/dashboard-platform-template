"""Seed data for operations: _alert_rules, _api_request_logs, GUARANTEED_PER_STATUS."""

from __future__ import annotations

from src.seed import catalog
from src.seed.operations.import_runs import _watchable
from src.seed.world import World

#: How many jobs every declared status is guaranteed, whatever the weighted
#: draw did at this scale.
#:
#: Two reasons it is a minimum rather than one.
#:
#: RETRYING is weighted at 0.04, so at the small scale it comes out empty about
#: half the time — and a queue console offering a RETRYING filter that can
#: never match anything is the same defect an empty kanban lane was (§76).
#:
#: And the end-to-end suite *consumes* these: it retries a job and cancels
#: another, and neither is reversible — a retry always spends an attempt. One
#: per status would make the suite a ratchet, draining a state per run until
#: the tests failed for want of a row, which is exactly what happened to the
#: `NEW` task lane. Headroom plus an additive `--sync-jobs` top-up is the same
#: answer `GUARANTEED_INBOX` gives for mailboxes.
GUARANTEED_PER_STATUS = 3


def _api_request_logs(world: World) -> None:
    from src.models.platform import ApiRequestLog

    rng = world.rng.derive("api-logs")
    if not world.api_clients:
        return

    for _ in range(world.scale.api_request_logs):
        client = rng.pick(world.api_clients)
        status_code = rng.weighted(
            ((200, 0.82), (201, 0.05), (400, 0.04), (401, 0.02), (403, 0.02), (404, 0.03), (429, 0.01), (500, 0.01))
        )
        world.api_request_logs.append(
            ApiRequestLog(
                id=rng.uuid(),
                api_client_id=client.id,
                requested_at=rng.recent(days=14),
                method=rng.weighted((("GET", 0.74), ("POST", 0.16), ("PUT", 0.05), ("PATCH", 0.03), ("DELETE", 0.02))),
                path=rng.pick(catalog.API_PATHS),
                status_code=status_code,
                duration_ms=rng.decimal(1.2, 2_400),
                ip_address=f"{rng.integer(10, 213)}.{rng.integer(0, 255)}.{rng.integer(0, 255)}.{rng.integer(1, 254)}",
                bytes_out=rng.integer(120, 900_000),
            )
        )


def _alert_rules(world: World) -> None:
    """Condition → action automation, on the same tree shape the advanced
    search builds — one editor and one compiler serve both (§49, §51).

    Every seeded rule is *runnable*: its resource is one the explorer declares,
    its condition names that resource's own fields, its `condition_text` is
    rendered by the same `describe_tree` the inspector uses, and its actions
    carry what `services/workflows` reads. A demonstration automation that
    fails on Dry run demonstrates nothing.
    """
    from src.core.rules import compile_tree, describe_tree
    from src.models.platform import AlertRule
    from src.services.records.explorer import resources

    rng = world.rng.derive("alerts")
    catalogue = {key: name for name, key, _ in catalog.ALERT_RULES}

    for resource_type, resource in sorted(resources().items()):
        watchable = _watchable(resource_type)
        if watchable is None:
            # A dataset with no state to watch cannot carry an automation.
            # Better one rule fewer than one that matches nothing forever.
            continue
        field, choices = watchable
        # Two or three of the states, so the rule reads as somebody's actual
        # worry rather than as "any of them".
        watched = rng.sample(choices, min(2, len(choices)))

        tree = {
            "type": "group",
            "conjunction": "AND",
            "children1": {
                # RAQB wraps a rule's value in a list, one entry per operator
                # cardinality — so a multi-select value is a list inside a list.
                "a": {
                    "type": "rule",
                    "properties": {
                        "field": field,
                        "operator": "select_any_in",
                        "value": [list(watched)],
                    },
                },
            },
        }
        # Compiled here and thrown away: a seed that cannot compile its own
        # condition has written a rule nobody can run, and the seed is the
        # right place to find that out.
        compile_tree(tree, resource.fields)

        name = catalogue.get(resource_type) or f"{resource.label} needing attention"
        severity = rng.pick(("INFO", "WARNING", "CRITICAL"))
        owner = rng.pick(world.users) if world.users else None
        world.alert_rules.append(
            AlertRule(
                id=rng.uuid(),
                name=name,
                description=(
                    f"Watches {resource.label.lower()} whose {field} is "
                    f"{' or '.join(watched)}, and tells somebody."
                ),
                resource_type=resource_type,
                enabled=rng.chance(0.7),
                severity=severity,
                condition_tree=tree,
                condition_text=describe_tree(tree, resource.fields),
                # The shape `services/workflows` validates and executes. A
                # role rather than a list of people, because the point of
                # addressing a role is that the answer changes as a team does.
                actions=[
                    {
                        "kind": "NOTIFY",
                        "recipients": {"user_ids": [], "role": "MANAGER", "owner": True},
                        "title": "{rule}: {record}",
                        "body": "Matched by the automation {rule}.",
                    },
                    *(
                        [
                            {
                                "kind": "TASK",
                                "title": "Follow up on {record}",
                                "priority": "HIGH" if severity == "CRITICAL" else "NORMAL",
                            }
                        ]
                        if rng.chance(0.4)
                        else []
                    ),
                ],
                schedule=rng.pick(("*/15 * * * *", "0 * * * *", "*/5 * * * *")),
                cooldown_minutes=rng.pick((15, 30, 60, 240)),
                owner_id=owner.id if owner else None,
                organization_id=world.organizations[0].id if world.organizations else None,
                last_triggered_at=rng.maybe(rng.recent(days=14), 0.7),
                trigger_count=rng.integer(0, 400),
                last_match_count=rng.integer(0, 60),
                created_at=rng.ago(days_min=40, days_max=500),
            )
        )
