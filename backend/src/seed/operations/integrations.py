"""Seed data for operations: _integrations, _change_for."""

from __future__ import annotations

from src.seed import catalog
from src.seed.world import World


def _integrations(world: World) -> None:
    from src.models.platform import Integration

    rng = world.rng.derive("integrations")
    for key, name, provider, category, icon in catalog.INTEGRATIONS:
        # Whether the *settings* are there comes first, because the status
        # depends on it. The first version drew a status independently and then
        # always wrote a complete configuration — so `NOT_CONFIGURED` was a
        # lie on every row it appeared on, three of twelve, contradicting the
        # very fact the "check" button exists to establish.
        configured = rng.chance(0.75)
        if not configured:
            status = "NOT_CONFIGURED"
        else:
            status = rng.weighted(
                (("CONNECTED", 0.55), ("DISCONNECTED", 0.25), ("ERROR", 0.2))
            )
        failing = status == "ERROR"
        # `enabled` is the operator's *intent* and the status is the outcome, so
        # the interesting row is one somebody switched on that is now failing —
        # which is exactly the row this page exists for, and the first version
        # could never produce because it set `enabled` from the status.
        enabled = status == "CONNECTED" or (failing and rng.chance(0.6))
        world.integrations.append(
            Integration(
                id=rng.uuid(),
                key=key,
                name=name,
                provider=provider,
                category=category,
                description=f"{name} integration for {category.replace('_', ' ').lower()}.",
                enabled=enabled,
                status=status,
                health="HEALTHY" if status == "CONNECTED" else "UNHEALTHY" if failing else "UNKNOWN",
                last_connected_at=rng.recent(days=10) if status == "CONNECTED" else rng.maybe(rng.ago(days_max=200), 0.5),
                last_error="401 from the provider: token expired." if failing else None,
                last_error_at=rng.recent(days=5) if failing else None,
                # Non-secret settings only. Anything sensitive is referenced by
                # name and lives in the deployment's secret store (§76).
                configuration={
                    "base_url": f"https://api.{key}.example",
                    "timeout_seconds": rng.pick((10, 30, 60)),
                    # Left out when the row is meant to be unconfigured, so
                    # `NOT_CONFIGURED` is a fact rather than a word.
                    **(
                        {"secret_ref": f"{key.upper()}_API_TOKEN"}
                        if configured
                        else {}
                    ),
                },
                required_settings=["base_url", "secret_ref"],
                icon=icon,
                docs_url=f"https://docs.nucleus.example/integrations/{key}",
                owner_id=rng.pick(world.users).id if world.users else None,
                created_at=rng.ago(days_min=40, days_max=700),
            )
        )


def _change_for(rng, action: str, resource_type: str) -> tuple[dict, dict]:
    """A plausible before/after pair, so the audit diff is worth opening."""
    if action in ("CREATE",):
        return {}, {"status": "NEW", "created": True}
    if action in ("DELETE",):
        return {"deleted_at": None}, {"deleted_at": "now"}
    if action == "STATUS_CHANGE":
        pair = rng.pick((("NEW", "IN_PROGRESS"), ("IN_PROGRESS", "DONE"), ("OPEN", "RESOLVED"), ("ACTIVE", "ON_HOLD")))
        return {"status": pair[0]}, {"status": pair[1]}
    if action == "PERMISSION_CHANGE":
        return (
            {"role": "OPERATOR", "permissions": ["records.view"]},
            {"role": "MANAGER", "permissions": ["records.view", "records.update", "users.manage"]},
        )
    if action == "CONFIGURATION_CHANGE":
        return {"session_timeout_minutes": 60}, {"session_timeout_minutes": rng.pick((30, 120, 480))}
    if action == "UPDATE":
        field, old, new = rng.pick(
            (
                ("priority", "NORMAL", "HIGH"),
                ("assignee", "Unassigned", "Ana Popescu"),
                ("due_date", "2026-04-01", "2026-04-15"),
                ("name", "Draft name", "Approved name"),
                ("progress", 40, 65),
            )
        )
        return {field: old}, {field: new}
    if action in ("EXPORT", "IMPORT", "BULK_UPDATE"):
        return {}, {"rows": rng.integer(10, 25_000), "entity": resource_type}
    return {}, {}
