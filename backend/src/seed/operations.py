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


# ── configuration ────────────────────────────────────────────────────────


def _system_settings(world: World) -> None:
    from src.models.platform import SystemSetting

    rng = world.rng.derive("settings")
    admin = world.personas.get("ADMINISTRATOR")

    for key, category, label, value_type, default, description in catalog.SYSTEM_SETTINGS:
        # Most settings sit at their default; a handful are overridden, which is
        # what gives the settings screen something to show as "changed".
        overridden = rng.chance(0.28)
        value = default
        if overridden:
            if value_type == "boolean":
                value = not default
            elif value_type == "integer":
                value = int(default * rng.pick((0.5, 2, 3)))
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
                options={"editable": True} if value_type != "boolean" else None,
                is_secret=False,
                requires_restart=key.startswith("limits.") and rng.chance(0.3),
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
                # A short series so the health page draws a sparkline per
                # service without a second table.
                history=[
                    {
                        "at": (world.anchor - timedelta(hours=hours)).isoformat(),
                        "latency_ms": float(rng.decimal(0.5, 350)),
                        "status": rng.weighted((("HEALTHY", 0.85), ("DEGRADED", 0.12), ("UNAVAILABLE", 0.03))),
                    }
                    for hours in range(23, -1, -1)
                ],
                created_at=rng.ago(days_min=60, days_max=400),
            )
        )


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
        enabled = rng.chance(0.45)
        status = "CONNECTED" if enabled else rng.weighted(
            (("NOT_CONFIGURED", 0.6), ("DISCONNECTED", 0.25), ("ERROR", 0.15))
        )
        failing = status == "ERROR"
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
                    "secret_ref": f"{key.upper()}_API_TOKEN",
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


def _background_jobs(world: World) -> None:
    from src.models.platform import BackgroundJob

    rng = world.rng.derive("jobs")
    for index in range(world.scale.background_jobs):
        kind = rng.weighted(catalog.JOB_KINDS)
        status = rng.weighted(catalog.JOB_STATUSES)
        initiator = rng.pick(world.users) if world.users else None
        scheduled = rng.pick(world.scheduled_tasks) if world.scheduled_tasks and rng.chance(0.3) else None

        total = rng.integer(10, 250_000)
        if status == "SUCCEEDED":
            processed, failed, progress = total, 0, 100
        elif status == "FAILED":
            processed = rng.integer(0, total)
            failed, progress = rng.integer(1, max(1, total - processed) or 1), int(processed / total * 100)
        elif status in ("QUEUED",):
            processed, failed, progress = 0, 0, 0
        else:
            processed = rng.integer(1, total)
            failed, progress = 0, int(processed / total * 100)

        started = rng.recent(days=20) if status != "QUEUED" else None
        duration = rng.integer(200, 5_400_000) if status in ("SUCCEEDED", "FAILED", "CANCELLED") else None
        finished = started + timedelta(milliseconds=duration) if started and duration else None

        world.background_jobs.append(
            BackgroundJob(
                id=rng.uuid(),
                reference=reference("JOB", index + 1, width=6),
                name=f"{kind.title()} — {rng.pick(('projects', 'orders', 'tickets', 'customers', 'tasks', 'audit log'))}",
                kind=kind,
                queue=rng.weighted((("default", 0.6), ("exports", 0.2), ("imports", 0.12), ("maintenance", 0.08))),
                status=status,
                priority=rng.weighted(catalog.PRIORITIES),
                progress=progress,
                total_units=total,
                processed_units=processed,
                failed_units=failed,
                attempt=rng.weighted(((1, 0.8), (2, 0.13), (3, 0.07))),
                max_attempts=3,
                started_at=started,
                finished_at=finished,
                duration_ms=duration,
                scheduled_for=rng.ahead(days_min=0, days_max=2) if status == "QUEUED" else None,
                initiated_by_id=initiator.id if initiator else None,
                initiated_by_label=initiator.full_name if initiator else "System",
                organization_id=initiator.organization_id if initiator else None,
                scheduled_task_id=scheduled.id if scheduled else None,
                error_message=rng.pick(catalog.JOB_ERRORS) if status == "FAILED" else None,
                payload={"entity": rng.pick(("project", "order", "ticket", "customer")), "format": rng.pick(("csv", "xlsx", "json"))},
                result=(
                    {"rows": processed, "artifact": f"exports/{reference('JOB', index + 1, width=6)}.csv"}
                    if status == "SUCCEEDED" else None
                ),
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
                        (9, "ERROR", rng.pick(catalog.JOB_ERRORS)) if status == "FAILED" else (9, "INFO", "finished"),
                    )
                ] if started else None,
                created_at=started or rng.recent(days=3),
            )
        )


# ── API access ───────────────────────────────────────────────────────────


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


def _alert_rules(world: World) -> None:
    """Condition → action automation, on the same tree shape the advanced
    search builds — one editor serves both (§49, §51)."""
    from src.core.rules import describe_tree
    from src.core.query import Field, FieldSet
    from src.models.business import Task
    from src.models.platform import AlertRule

    rng = world.rng.derive("alerts")
    # A minimal FieldSet, purely so the stored `condition_text` is rendered by
    # the same code the inspector uses rather than written by hand here.
    spec = FieldSet(
        Field("status", Task.status, kind="enum", label="Status"),
        Field("priority", Task.priority, kind="enum", label="Priority"),
        Field("due_date", Task.due_date, kind="datetime", label="Due date"),
    )

    for name, resource_type, severity in catalog.ALERT_RULES:
        tree = {
            "type": "group",
            "conjunction": "AND",
            "children1": {
                # RAQB wraps a rule's value in a list, one entry per operator
                # cardinality — so a multi-select value is a list inside a list.
                "a": {
                    "type": "rule",
                    "properties": {
                        "field": "priority",
                        "operator": "select_any_in",
                        "value": [["CRITICAL", "HIGH"]],
                    },
                },
                "b": {
                    "type": "rule",
                    "properties": {
                        "field": "status",
                        "operator": "select_not_any_in",
                        "value": [["DONE"]],
                    },
                },
            },
        }
        world.alert_rules.append(
            AlertRule(
                id=rng.uuid(),
                name=name,
                description=f"{name} — notifies the owning team and raises a task.",
                resource_type=resource_type,
                enabled=rng.chance(0.8),
                severity=severity,
                condition_tree=tree,
                condition_text=describe_tree(tree, spec),
                actions=[
                    {"type": "NOTIFY", "audience": "OWNERS"},
                    {"type": "EMAIL", "template": "sla-breach"} if rng.chance(0.5) else {"type": "TASK", "assignee": "OWNER"},
                ],
                schedule=rng.pick(("*/15 * * * *", "0 * * * *", "*/5 * * * *")),
                cooldown_minutes=rng.pick((15, 30, 60, 240)),
                owner_id=rng.pick(world.users).id if world.users else None,
                organization_id=world.organizations[0].id if world.organizations else None,
                last_triggered_at=rng.maybe(rng.recent(days=14), 0.7),
                trigger_count=rng.integer(0, 400),
                last_match_count=rng.integer(0, 60),
                created_at=rng.ago(days_min=40, days_max=500),
            )
        )


def _import_runs(world: World) -> None:
    from src.models.platform import ImportRun

    rng = world.rng.derive("imports")
    for index in range(world.scale.import_runs):
        entity = rng.pick(("customer", "project", "order", "task", "device"))
        status = rng.weighted(
            (("COMPLETED", 0.5), ("FAILED", 0.15), ("DRAFT", 0.15), ("VALIDATED", 0.12), ("RUNNING", 0.08))
        )
        total = rng.integer(20, 25_000)
        invalid = rng.integer(0, max(1, total // 8))
        skipped = rng.integer(0, max(1, total // 20))
        valid = total - invalid
        imported = valid - skipped if status == "COMPLETED" else 0

        world.import_runs.append(
            ImportRun(
                id=rng.uuid(),
                reference=reference("IMP", index + 1, width=6),
                target_entity=entity,
                filename=f"{entity}s-{rng.integer(2024, 2026)}-{rng.integer(1, 12):02d}.csv",
                status=status,
                step={"DRAFT": "UPLOAD", "VALIDATED": "PREVIEW", "RUNNING": "EXECUTE"}.get(status, "DONE"),
                delimiter=rng.pick((",", ";")),
                total_rows=total,
                valid_rows=valid,
                invalid_rows=invalid,
                skipped_rows=skipped,
                imported_rows=imported,
                detected_columns=[
                    {"index": i, "name": name, "sample": f"sample-{i}"}
                    for i, name in enumerate(("code", "name", "email", "country", "segment"))
                ],
                column_mapping={"code": "code", "name": "name", "email": "email", "country": "country"},
                errors=[
                    {"row": rng.integer(2, total), "column": "email", "message": "not a valid address"}
                    for _ in range(min(invalid, 12))
                ] or None,
                created_by_id=rng.pick(world.users).id if world.users else None,
                completed_at=rng.recent(days=20) if status in ("COMPLETED", "FAILED") else None,
                created_at=rng.recent(days=40),
            )
        )


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
                severity=rng.weighted((("INFO", 0.7), ("WARNING", 0.2), ("CRITICAL", 0.1))),
                title=title,
                body=body,
                icon={"MENTION": "at", "ASSIGNMENT": "user-check", "APPROVAL": "check-circle",
                      "SYSTEM": "settings", "SECURITY": "shield", "REPORT": "bar-chart"}[category],
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
