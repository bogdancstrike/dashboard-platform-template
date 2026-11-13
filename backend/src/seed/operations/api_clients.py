"""Seed data for operations: _service_health, _api_clients."""

from __future__ import annotations

from src.core.auth import ALL_PERMISSIONS
from src.seed import catalog
from src.seed.operations.audit_and_activity import _health_series
from src.seed.support import mask_hash
from src.seed.world import World


def _service_health(world: World) -> None:
    from src.models.platform import ServiceHealth

    rng = world.rng.derive("service-health")
    for key, name, category in catalog.MONITORED_SERVICES:
        status = rng.weighted((("HEALTHY", 0.72), ("DEGRADED", 0.16), ("UNAVAILABLE", 0.07), ("UNKNOWN", 0.05)))
        latency = {
            "HEALTHY": rng.decimal(0.4, 40), "DEGRADED": rng.decimal(120, 900),
            "UNAVAILABLE": None, "UNKNOWN": None,
        }[status]
        world.service_health.append(
            ServiceHealth(
                id=rng.uuid(),
                key=key,
                name=name,
                category=category,
                status=status,
                latency_ms=latency,
                error_rate=rng.decimal(0, 0.4 if status != "HEALTHY" else 0.02, places=3),
                request_volume=rng.integer(200, 900_000),
                uptime_percent=rng.decimal(96.5 if status != "HEALTHY" else 99.5, 100, places=3),
                last_checked_at=rng.recent(days=1),
                message={
                    "HEALTHY": None,
                    "DEGRADED": "Elevated latency on the primary replica.",
                    "UNAVAILABLE": "Connection refused on the last three checks.",
                    "UNKNOWN": "No probe has run since the last restart.",
                }[status],
                # Thirty days of it, at two resolutions: hourly for the last
                # two days and every four hours before that. The page asks
                # "was it working at four o'clock" as often as "is it working
                # now", and a series that stopped at twenty-four hours could
                # only answer the second — while a flat hourly month would be
                # seven hundred points nobody can read.
                history=_health_series(rng, world.anchor),
                created_at=rng.ago(days_min=60, days_max=400),
            )
        )


def _api_clients(world: World) -> None:
    """Machine consumers and their credentials.

    Only a hash and a short prefix are stored. The plaintext exists for exactly
    one response, at creation — §76 is a schema decision here, not a UI one,
    because a column that *can* hold a secret eventually does.
    """
    from src.models.platform import ApiClient, ApiCredential

    rng = world.rng.derive("api")
    scopes = list(ALL_PERMISSIONS)

    for index, (key, name, provider, _category, _icon) in enumerate(catalog.INTEGRATIONS):
        organization = rng.pick(world.organizations)
        members = world.users_by_org.get(organization.id, [])
        status = rng.weighted((("ACTIVE", 0.75), ("SUSPENDED", 0.12), ("REVOKED", 0.13)))
        requests_total = rng.integer(100, 4_000_000)

        client = ApiClient(
            id=rng.uuid(),
            name=f"{name} connector",
            client_id=f"cli_{rng.uuid().hex[:20]}",
            description=f"Server-to-server client used by the {provider} integration.",
            status=status,
            organization_id=organization.id,
            owner_id=rng.pick(members).id if members else None,
            scopes=rng.sample(scopes, rng.integer(2, 10)),
            rate_limit_per_minute=rng.pick((60, 300, 600, 1200)),
            quota_per_day=rng.pick((10_000, 50_000, 100_000, 1_000_000)),
            requests_today=rng.integer(0, 40_000),
            requests_total=requests_total,
            error_rate=rng.decimal(0, 0.09, places=3),
            last_used_at=rng.maybe(rng.recent(days=7), 0.85),
            allowed_ips=(
                [f"{rng.integer(10, 200)}.{rng.integer(0, 255)}.{rng.integer(0, 255)}.0/24"]
                if rng.chance(0.4) else None
            ),
            created_at=rng.ago(days_min=30, days_max=900),
        )
        world.api_clients.append(client)

        previous = None
        for label in ("Primary", "Rotation")[: rng.integer(1, 2)]:
            secret = f"sk_{rng.uuid().hex}"
            revoked = label == "Rotation" and rng.chance(0.4)
            credential = ApiCredential(
                id=rng.uuid(),
                api_client_id=client.id,
                label=f"{label} key",
                prefix=secret[:8],
                secret_hash=mask_hash(secret),
                status="REVOKED" if revoked else "ACTIVE",
                created_by_id=client.owner_id,
                expires_at=rng.maybe(rng.ahead(days_min=30, days_max=700), 0.6),
                last_used_at=rng.maybe(rng.recent(days=14), 0.8),
                revoked_at=rng.recent(days=30) if revoked else None,
                revoked_by_id=client.owner_id if revoked else None,
                rotated_from_id=previous.id if previous and label == "Rotation" else None,
                created_at=rng.between(client.created_at, world.anchor),
            )
            world.api_credentials.append(credential)
            previous = credential
