"""Platform operations: audit, activity, logs, jobs, flags, API, integrations.

These are the tables an operator opens when something is wrong, so the seed's
job is to make them *look* like a system that has been running — a log stream
whose levels are mostly INFO with a plausible tail of errors, jobs that mostly
succeeded, an audit trail whose entries line up with records that exist.

Audit rows carry both sides of the change and the computed field list, matching
what `core/audit.py` writes at runtime. A demo audit drawer that cannot show a
diff is a demo of nothing.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from src.core import vocabulary
from src.core.auth import ALL_PERMISSIONS
from src.seed import catalog
from src.seed.support import mask_hash, reference
from src.seed.world import World

AUDIT_ACTIONS: tuple[tuple[str, float], ...] = (
    ("UPDATE", 0.3), ("CREATE", 0.2), ("VIEW", 0.12), ("DELETE", 0.06),
    ("EXPORT", 0.07), ("LOGIN", 0.09), ("STATUS_CHANGE", 0.05),
    ("PERMISSION_CHANGE", 0.03), ("BULK_UPDATE", 0.03), ("IMPORT", 0.02),
    ("CONFIGURATION_CHANGE", 0.02), ("IMPERSONATE", 0.01),
)


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


# ── configuration ────────────────────────────────────────────────────────


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


def _feature_flags(world: World) -> None:
    from src.models.platform import FeatureFlag

    rng = world.rng.derive("flags")
    admins = [u for u in world.users if u.id in {p.id for p in world.personas.values()}]

    for key, name, description, stage, experimental in catalog.FEATURE_FLAGS:
        enabled = stage == "GA" or (stage == "BETA" and rng.chance(0.6))
        rollout = 100 if stage == "GA" else rng.pick((0, 5, 10, 25, 50, 75))
        world.feature_flags.append(
            FeatureFlag(
                id=rng.uuid(),
                key=key,
                name=name,
                description=description,
                enabled=enabled,
                environment=rng.pick(("production", "production", "staging")),
                stage=stage,
                rollout_percentage=rollout,
                target_user_ids=(
                    [str(u.id) for u in rng.sample(world.users, rng.integer(1, 4))]
                    if stage == "ALPHA" and world.users else None
                ),
                target_roles=["ADMINISTRATOR"] if stage == "ALPHA" else None,
                owner_id=rng.pick(admins).id if admins else None,
                updated_by_id=rng.pick(admins).id if admins else None,
                last_toggled_at=rng.maybe(rng.recent(days=60), 0.7),
                experimental=experimental,
                created_at=rng.ago(days_min=30, days_max=600),
            )
        )


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


# ── jobs ─────────────────────────────────────────────────────────────────


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


def background_job(rng, *, index: int, status: str, users, scheduled_tasks, fresh: bool = False):
    """One job, built but not stored.

    Shared by the seed and by `--sync-jobs`, which tops up an existing
    database: two copies of "what a job looks like" is how a repair ends up
    writing rows the page renders differently from the seeded ones.

    `status` is passed in rather than drawn here, because the caller is the one
    that knows whether it is filling a distribution or covering a gap.

    `fresh` caps the attempt below `max_attempts`, so the job can still be
    retried. The draw gives attempt 3 about seven times in a hundred, and a
    job born at 3 of 3 is *spent* — which is fine in a distribution and useless
    in a repair whose whole purpose is to provide something actionable. A
    repair that fixed the problem ninety-three per cent of the time is one
    somebody runs twice and still does not trust.

    `fresh` also keeps the *kind* to one the queue console will retry. An
    EXPORT is re-requested rather than retried (`services/jobs.NOT_OURS_TO_RETRY`),
    so a top-up that drew one produced a row that satisfied the repair's count
    and none of its purpose — which is exactly what happened: `--sync-jobs`
    reported "2 added" and the end-to-end suite went on failing for want of a
    retryable cancelled job.
    """
    from src.models.platform import BackgroundJob
    from src.services.jobs import NOT_OURS_TO_RETRY

    kinds = (
        tuple((kind, weight) for kind, weight in catalog.JOB_KINDS
               if kind not in NOT_OURS_TO_RETRY)
        if fresh
        else catalog.JOB_KINDS
    )
    kind = rng.weighted(kinds)
    initiator = rng.pick(users) if users else None
    scheduled = rng.pick(scheduled_tasks) if scheduled_tasks and rng.chance(0.3) else None

    total = rng.integer(10, 250_000)
    if status == "SUCCEEDED":
        processed, failed, progress = total, 0, 100
    elif status in ("FAILED", "RETRYING"):
        # RETRYING is a job that *has already failed* and will be tried again,
        # so it carries the failure that caused the retry. Without that the
        # page can say a job is retrying and never say why — and "failed and
        # will be tried again" versus "failed and will not" is the single
        # distinction an operator reads this screen for.
        processed = rng.integer(0, total)
        failed = rng.integer(1, max(1, total - processed) or 1)
        progress = int(processed / total * 100)
    elif status == "QUEUED":
        processed, failed, progress = 0, 0, 0
    else:
        processed = rng.integer(1, total)
        failed, progress = 0, int(processed / total * 100)

    started = rng.recent(days=20) if status != "QUEUED" else None
    duration = rng.integer(200, 5_400_000) if status in ("SUCCEEDED", "FAILED", "CANCELLED") else None
    finished = started + timedelta(milliseconds=duration) if started and duration else None
    # A retry is not the first attempt, by definition — and it has not used up
    # `max_attempts`, or it would be FAILED for good.
    if status == "RETRYING":
        attempt = 2
    elif fresh:
        attempt = rng.weighted(((1, 0.85), (2, 0.15)))
    else:
        attempt = rng.weighted(((1, 0.8), (2, 0.13), (3, 0.07)))
    failure = rng.pick(catalog.JOB_ERRORS) if status in ("FAILED", "RETRYING") else None

    return BackgroundJob(
        id=rng.uuid(),
        # An export carries the prefix `/exports` shows, because that is the
        # string somebody quotes back ("EXP-000012 downloaded empty") — and
        # because an export a person requests has to be indistinguishable from
        # a seeded one or the demo splits into "the real ones and mine".
        # Sparse within its own prefix, which `core/naming` is fine with: the
        # next one is `MAX(reference) + 1`, not a count.
        reference=reference("EXP" if kind == "EXPORT" else "JOB", index + 1, width=6),
        name=f"{kind.title()} — {rng.pick(('projects', 'orders', 'tickets', 'customers', 'tasks', 'audit log'))}",
        kind=kind,
        queue=rng.weighted((("default", 0.6), ("exports", 0.2), ("imports", 0.12), ("maintenance", 0.08))),
        status=status,
        priority=rng.weighted(catalog.PRIORITIES),
        progress=progress,
        total_units=total,
        processed_units=processed,
        failed_units=failed,
        attempt=attempt,
        max_attempts=3,
        started_at=started,
        finished_at=finished,
        duration_ms=duration,
        scheduled_for=rng.ahead(days_min=0, days_max=2) if status == "QUEUED" else None,
        initiated_by_id=initiator.id if initiator else None,
        initiated_by_label=initiator.full_name if initiator else "System",
        organization_id=initiator.organization_id if initiator else None,
        scheduled_task_id=scheduled.id if scheduled else None,
        error_message=failure,
        # A resource key and a format, which for an EXPORT is a real
        # `explorer.Plan` — `seed/exports.py` fills in the rest and produces
        # the file. The old payload named an "entity" nothing could resolve and
        # claimed an artefact nobody had written, so every download 404'd.
        payload={
            "resource_type": rng.pick(("project", "order", "ticket", "customer")),
            "format": rng.pick(("csv", "xlsx", "json")),
        },
        # Deliberately empty. What a finished export produced is written by
        # whatever produced it, and a seeded `{"rows": …, "artifact": …}` was a
        # claim about bytes that did not exist.
        result=None,
        # Inline log lines so the job drawer needs no join.
        log_lines=[
            {
                "at": (started + timedelta(seconds=offset)).isoformat() if started else None,
                "level": level,
                "message": message,
            }
            for offset, level, message in (
                (0, "INFO", "job accepted"),
                (2, "INFO", f"processing {total} units"),
                (5, "WARNING", "slow batch, continuing") if rng.chance(0.3) else (5, "INFO", "halfway"),
                (9, "ERROR", failure) if failure else (9, "INFO", "finished"),
            )
        ] if started else None,
        created_at=started or rng.recent(days=3),
    )


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


def _watchable(resource_type: str) -> tuple[str, tuple[str, ...]] | None:
    """A status-like field of a dataset, and the values it actually takes.

    Derived from the `Resource` declaration and its vocabulary rather than
    typed out, for the reason the seeded *reports* taught: this function's
    predecessor built every rule out of a literal `priority` / `status` pair
    and a hand-made `FieldSet`, and pointed rules at `"job"`, `"user"` and
    `"file"` — three keys the explorer does not declare. So half the seeded
    automations watched a dataset that cannot be selected from, and the other
    half stored a `condition_text` rendered against fields the engine would
    compile against a *different* set. Every one of them was unrunnable, which
    is what somebody finds the moment they open the page and press Dry run.
    """
    from src.services.explorer import resources

    resource = resources().get(resource_type)
    if resource is None:
        return None
    for name in (resource.status_field, "priority", "status"):
        field = resource.fields.by_name.get(name) if name else None
        if field is not None and field.kind == "enum" and field.filterable and field.choices:
            return field.name, tuple(field.choices)
    return None


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
    from src.services.explorer import resources

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


def _import_runs(world: World) -> None:
    """One row per run of the import wizard, and every number in it true (§29).

    The first version of this was wrong in five ways at once, and building
    `/import` found all five. It drew `valid = total - invalid` beside a
    separate non-zero `skipped`, so three of the four counts could not all be
    right. It gave every run the same five column names — `code, name, email,
    country, segment` — whatever it was importing into, and mapped four of them
    onto fields `order` and `task` do not have, so the page could not describe
    a single seeded run. It drew up to 25,000 rows, well past what one import
    may carry. Its errors cited an `email` column on datasets with no email.
    And a DRAFT run had no staged rows, so resuming one showed an empty wizard
    — the state the whole flow exists to support.

    So the columns are derived from the target's own writable declarations, the
    counts are computed from staged rows that exist, and an open run carries
    the file it is in the middle of.
    """
    from src.core import importer
    from src.models.platform import ImportRun
    from src.services import explorer

    rng = world.rng.derive("imports")
    # Only datasets that can be created, from the registry: a seeded run
    # naming something the API cannot import into is a row the page has to
    # apologise for.
    targets = [
        resource
        for _key, resource in sorted(explorer.resources().items())
        if resource.identity is not None
    ]
    if not targets:  # pragma: no cover - the registry always has some
        return

    for index in range(world.scale.import_runs):
        resource = rng.pick(targets)
        status = rng.weighted(
            (("COMPLETED", 0.5), ("FAILED", 0.15), ("DRAFT", 0.15), ("VALIDATED", 0.12), ("RUNNING", 0.08))
        )
        # A real spreadsheet's worth, and inside the wizard's own cap: every
        # row lives in JSONB and is rewritten on each mapping change.
        total = rng.integer(20, min(400, importer.MAX_ROWS))
        columns, mapping = _import_columns(rng, resource)
        open_run = status in ("DRAFT", "VALIDATED")
        # An open run holds the file it is in the middle of, and its total *is*
        # what it holds: two independent numbers let a draft claim four hundred
        # rows and stage sixty, which the preview footer would then have
        # described wrongly.
        rows = _import_rows(rng, columns, min(total, 60)) if open_run else None
        if rows is not None:
            total = len(rows)

        invalid = rng.integer(0, max(1, total // 8))
        skipped = rng.integer(0, max(1, total // 20))
        valid = total - invalid - skipped
        imported = valid if status == "COMPLETED" else 0

        world.import_runs.append(
            ImportRun(
                id=rng.uuid(),
                reference=reference("IMP", index + 1, width=6),
                target_entity=resource.key,
                filename=f"{resource.key}s-{rng.integer(2024, 2026)}-{rng.integer(1, 12):02d}.csv",
                status=status,
                step={"DRAFT": "MAPPING", "VALIDATED": "PREVIEW", "RUNNING": "EXECUTE"}.get(status, "DONE"),
                delimiter=rng.pick((",", ";")),
                total_rows=total,
                # A DRAFT has been read but not validated, so its outcome
                # counts are not yet facts about anything.
                valid_rows=0 if status == "DRAFT" else valid,
                invalid_rows=0 if status == "DRAFT" else invalid,
                skipped_rows=0 if status == "DRAFT" else skipped,
                imported_rows=imported,
                detected_columns=columns,
                column_mapping=mapping,
                # Cited against a column that is actually in the file and a
                # field that is actually mapped, in the shape `/import` reads.
                errors=_import_errors(rng, mapping, total, invalid)
                if status != "DRAFT"
                else None,
                # An open run is one somebody is in the middle of, so it holds
                # the file. A finished one does not: the rows have become
                # records, and keeping the spreadsheet as well would be holding
                # the data twice.
                staged_rows=rows,
                created_by_id=rng.pick(world.users).id if world.users else None,
                completed_at=rng.recent(days=20) if status in ("COMPLETED", "FAILED") else None,
                created_at=rng.recent(days=40),
            )
        )


def _import_columns(rng, resource) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """The columns a seeded file has, and what they map onto.

    Derived from the target's writable fields — headed the way a person would
    write them, with a couple of columns the mapping deliberately ignores,
    because a file that maps perfectly is not what anybody's export looks like.
    """
    writable = sorted(resource.writable)
    chosen = writable[: rng.integer(3, min(6, len(writable)))]

    columns: list[dict[str, Any]] = []
    mapping: dict[str, str] = {}
    for position, name in enumerate(chosen):
        # The label rather than the field name: an export from another system
        # is headed "Due date", which is what makes the mapping step earn its
        # place.
        header = resource.fields.by_name[name].title
        columns.append({"index": position, "name": header, "samples": []})
        mapping[header] = name

    # One column nothing maps onto — every real export has an internal id or a
    # legacy code in it.
    columns.append({"index": len(columns), "name": "legacy_ref", "samples": []})
    return columns, mapping


def _import_rows(rng, columns: list[dict[str, Any]], count: int) -> list[dict[str, str]]:
    """Staged rows for a run somebody is in the middle of.

    Values that read as a spreadsheet's rather than as a database's: this is a
    file, and what makes the wizard's preview worth looking at is that its
    contents look like something somebody typed.
    """
    names = [str(column["name"]) for column in columns]
    return [
        {
            name: (
                f"{name.split()[0].lower()}-{row + 1:04d}"
                if row % 7
                # A deliberate hole every seventh row: the preview's empty
                # cells and the "nothing in any mapped column" case are both
                # states the page has to render.
                else ""
            )
            for name in names
        }
        for row in range(count)
    ]


def _import_errors(rng, mapping: dict[str, str], total: int, invalid: int) -> list[dict[str, Any]] | None:
    """Row-level problems, on columns the file has and fields it maps.

    The old version cited an `email` column on datasets with no email, keyed
    the line as `row`, and carried no value — so the error report the wizard
    downloads would have had three empty columns out of four.
    """
    if not invalid or not mapping:
        return None
    pairs = sorted(mapping.items())
    out: list[dict[str, Any]] = []
    for position in range(min(invalid, 12)):
        column, field = pairs[position % len(pairs)]
        line = min(total + 1, 2 + position * 3)
        out.append(
            {
                "line": line,
                "column": column,
                "field": field,
                "value": f"not-a-{field}",
                "message": f"{column} could not be read as {field}.",
            }
        )
    return out


# ── history ──────────────────────────────────────────────────────────────


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

    targets: list[tuple[str, object, str, object]] = []
    for project in world.projects:
        targets.append(("project", project.id, project.name, project.organization_id))
    for task in world.tasks:
        targets.append(("task", task.id, task.title, task.organization_id))
    for ticket in world.tickets:
        targets.append(("ticket", ticket.id, ticket.subject, ticket.organization_id))
    for order in world.orders:
        targets.append(("order", order.id, order.reference, order.organization_id))
    for customer in world.customers:
        targets.append(("customer", customer.id, customer.name, customer.organization_id))
    for user in world.users:
        targets.append(("user", user.id, user.full_name, user.organization_id))
    if not targets:
        return

    projects_by_org: dict = {}
    for project in world.projects:
        projects_by_org.setdefault(project.organization_id, []).append(project)

    for _ in range(world.scale.audit_logs):
        actor = rng.pick(world.users)
        action = rng.weighted(AUDIT_ACTIONS)
        resource_type, resource_id, label, organization_id = rng.pick(targets)
        occurred = rng.business_hour(rng.recent(days=180))
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


def _role_code(world: World, user) -> str:
    for role in world.roles:
        if role.id == user.role_id:
            return role.code
    return "VIEWER"


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



def _announcements(world: World) -> None:
    """Notices in every state a reader or an author can encounter.

    Deliberately spread across the lifecycle rather than all published: the
    author's list is a page too, and a dataset where every notice is live
    cannot demonstrate a draft, a schedule or an expiry. What the *reader's*
    page shows is then a genuine subset, which is the point — a seed where
    every row passes the filter proves the filter untested.
    """
    from src.models.platform import Announcement, AnnouncementReceipt

    rng = world.rng.derive("announcements")
    if not world.users:
        return

    author = world.personas.get("ADMINISTRATOR") or world.users[0]
    organization_id = author.organization_id
    audiences: tuple[tuple[list[str], float], ...] = (
        # Most notices are for everybody — that is what a notice is.
        ([], 0.7),
        (["MANAGER", "ADMINISTRATOR"], 0.2),
        (["VIEWER"], 0.1),
    )

    for index in range(world.scale.announcements):
        title, category, severity, body = catalog.ANNOUNCEMENTS[
            index % len(catalog.ANNOUNCEMENTS)
        ]
        if index >= len(catalog.ANNOUNCEMENTS):
            title = f"{title} ({index // len(catalog.ANNOUNCEMENTS) + 1})"

        # Every state is *guaranteed* for the first four, then weighted for
        # the rest. Left to chance alone, a small-scale dataset produced no
        # expired notice and no draft at all — and a demo where a state cannot
        # be seen is a demo of a page whose filter has never been used.
        state = (
            ("PUBLISHED", "EXPIRED", "SCHEDULED", "DRAFT")[index]
            if index < 4
            else rng.weighted(
                (("PUBLISHED", 0.6), ("EXPIRED", 0.2), ("SCHEDULED", 0.1), ("DRAFT", 0.1))
            )
        )
        if state == "DRAFT":
            status, publish_at, expires_at = "DRAFT", None, None
        elif state == "SCHEDULED":
            status = "SCHEDULED"
            publish_at = rng.between(world.anchor, world.anchor + timedelta(days=14))
            expires_at = publish_at + timedelta(days=rng.integer(7, 30))
        elif state == "EXPIRED":
            status = "PUBLISHED"
            publish_at = rng.ago(days_min=60, days_max=200)
            expires_at = publish_at + timedelta(days=rng.integer(3, 21))
        else:
            status = "PUBLISHED"
            publish_at = rng.recent(days=45)
            # Half of the live ones never expire: a policy is not a window.
            expires_at = (
                publish_at + timedelta(days=rng.integer(20, 120)) if rng.chance(0.5) else None
            )

        roles = rng.weighted(audiences)
        # A critical notice asks to be acknowledged; a release does not.
        requires_ack = severity == "CRITICAL" or (category == "POLICY" and rng.chance(0.5))

        announcement = Announcement(
            id=rng.uuid(),
            title=title,
            body=body,
            category=category,
            severity=severity,
            status=status,
            publish_at=publish_at,
            expires_at=expires_at,
            audience_roles=list(roles),
            # Left open to every tenant most of the time: a platform notice is
            # a platform notice.
            organization_id=None if rng.chance(0.7) else organization_id,
            requires_acknowledgement=requires_ack,
            # Pinned below, once it is known which one is newest and live: a
            # list where everything is pinned has nothing pinned.
            is_pinned=False,
            link="/settings/system" if category == "MAINTENANCE" else None,
            author_id=author.id,
            author_label=author.full_name,
            created_at=publish_at or rng.ago(days_min=1, days_max=30),
        )
        world.announcements.append(announcement)

        if status != "PUBLISHED":
            continue

        # Receipts for some of the people it reached. Written on the reader's
        # action in the product, so the seed writes them for *some* readers
        # only — a notice everybody has read cannot demonstrate an unread one.
        readers = [
            user
            for user in ([*world.personas.values()] * 2 + world.users)
            if not roles or _role_code(world, user) in roles
        ]
        for user in {user.id: user for user in readers}.values():
            if not rng.chance(0.55):
                continue
            read_at = rng.between(publish_at, world.anchor)
            world.announcement_receipts.append(
                AnnouncementReceipt(
                    id=rng.uuid(),
                    announcement_id=announcement.id,
                    user_id=user.id,
                    read_at=read_at,
                    # Fewer acknowledge than read, which is the whole reason
                    # they are two columns.
                    acknowledged_at=(
                        rng.between(read_at, world.anchor)
                        if requires_ack and rng.chance(0.6)
                        else None
                    ),
                    created_at=read_at,
                )
            )

    # Exactly one pin, on the newest live notice. Decided after the loop
    # because "the newest live one" is not knowable while building them.
    live = [
        item
        for item in world.announcements
        if item.status == "PUBLISHED"
        and item.publish_at is not None
        and (item.expires_at is None or item.expires_at > world.anchor)
    ]
    if live:
        max(live, key=lambda item: item.publish_at).is_pinned = True


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
