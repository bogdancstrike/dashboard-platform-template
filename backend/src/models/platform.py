"""Platform-operations tables: audit, logs, jobs, flags, integrations, alerts.

These are the tables an operator looks at when something is wrong, which is why
they are shaped for *filtering at speed* rather than for normalisation: wide
rows, indexed discriminators, denormalised labels. An audit list that has to
join four tables to render a row is an audit list nobody waits for.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    DateTime,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import (
    Base,
    MetadataMixin,
    SoftDeleteMixin,
    TimestampMixin,
    fk,
    uuid_pk,
)


class AuditLog(Base, TimestampMixin):
    """Who did what, to which resource, from where, and what changed (§21).

    `actor_label` is denormalised on purpose: an audit row must stay readable
    after the user it refers to is deleted, and the whole point of an audit
    trail is that it survives the thing it describes.
    """

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_resource", "resource_type", "resource_id"),
        Index("ix_audit_actor_time", "actor_id", "occurred_at"),
    )

    id: Mapped[UUID] = uuid_pk()
    occurred_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    resource_id: Mapped[str | None] = mapped_column(String(64), index=True)
    resource_label: Mapped[str | None] = mapped_column(String(255))
    actor_id: Mapped[UUID | None] = fk("users.id")
    actor_label: Mapped[str | None] = mapped_column(String(160), index=True)
    actor_role: Mapped[str | None] = mapped_column(String(48), index=True)
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    result: Mapped[str] = mapped_column(String(16), default="SUCCESS", index=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), index=True)
    user_agent: Mapped[str | None] = mapped_column(String(400))
    correlation_id: Mapped[str | None] = mapped_column(String(64), index=True)
    message: Mapped[str | None] = mapped_column(String(500))
    #: Both sides of the change, plus the computed field list, so the detail
    #: drawer (§21) needs no second query and no diffing in the browser.
    state_before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    state_after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    changed_fields: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    changes: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: Both identities, because "who did this" has two answers when an
    #: administrator is acting as somebody else (§12, §21). `actor_*` is who
    #: the system was treating the request as; these are who was actually at
    #: the keyboard. A boolean alone says an impersonation happened and leaves
    #: the only question anybody asks afterwards unanswered.
    impersonated: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    impersonator_id: Mapped[UUID | None] = fk("users.id")
    impersonator_label: Mapped[str | None] = mapped_column(String(160), index=True)


class ActivityEntry(Base, TimestampMixin):
    """The human-readable feed (§35) — one row per notable thing, scoped so a
    project page can show only its own story."""

    __tablename__ = "activity_entries"
    __table_args__ = (Index("ix_activity_resource", "resource_type", "resource_id"),)

    id: Mapped[UUID] = uuid_pk()
    occurred_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(24), default="RECORD", index=True)
    action: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    actor_id: Mapped[UUID | None] = fk("users.id")
    actor_label: Mapped[str | None] = mapped_column(String(160))
    resource_type: Mapped[str | None] = mapped_column(String(48), index=True)
    resource_id: Mapped[str | None] = mapped_column(String(64), index=True)
    resource_label: Mapped[str | None] = mapped_column(String(255))
    project_id: Mapped[UUID | None] = fk("projects.id")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    summary: Mapped[str | None] = mapped_column(String(500))
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    actor = relationship("User", foreign_keys=[actor_id], lazy="joined")


class SystemLog(Base):
    """Application log lines (§22). No `updated_at`: a log line is never edited,
    and the column would only be a lie taking up space."""

    __tablename__ = "system_logs"
    __table_args__ = (Index("ix_syslog_level_time", "level", "logged_at"),)

    id: Mapped[UUID] = uuid_pk()
    logged_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    level: Mapped[str] = mapped_column(String(12), nullable=False, index=True)
    service: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    logger: Mapped[str | None] = mapped_column(String(120), index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    correlation_id: Mapped[str | None] = mapped_column(String(64), index=True)
    trace_id: Mapped[str | None] = mapped_column(String(64), index=True)
    span_id: Mapped[str | None] = mapped_column(String(32))
    user_id: Mapped[UUID | None] = fk("users.id")
    host: Mapped[str | None] = mapped_column(String(96), index=True)
    environment: Mapped[str] = mapped_column(String(24), default="local", index=True)
    duration_ms: Mapped[float | None] = mapped_column(Numeric(10, 2))
    status_code: Mapped[int | None] = mapped_column(Integer, index=True)
    #: Stack trace / structured context, expanded in the detail pane (§63).
    context: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    stack_trace: Mapped[str | None] = mapped_column(Text)


class Notification(Base, TimestampMixin):
    """In-app notifications (§17)."""

    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notification_user_read", "user_id", "is_read"),)

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID | None] = fk("users.id", ondelete="CASCADE")
    category: Mapped[str] = mapped_column(String(24), default="INFO", index=True)
    severity: Mapped[str] = mapped_column(String(16), default="INFO", index=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(48))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    read_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    #: Where clicking it goes. A notification you cannot act on is noise (§66).
    link: Mapped[str | None] = mapped_column(String(500))
    resource_type: Mapped[str | None] = mapped_column(String(48), index=True)
    resource_id: Mapped[str | None] = mapped_column(String(64))
    actor_id: Mapped[UUID | None] = fk("users.id")
    actor_label: Mapped[str | None] = mapped_column(String(160))
    group_key: Mapped[str | None] = mapped_column(String(96), index=True)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class BackgroundJob(Base, TimestampMixin):
    """Job monitoring (§23), and the sink for long exports and imports (§30)."""

    __tablename__ = "background_jobs"

    id: Mapped[UUID] = uuid_pk()
    reference: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(48), default="EXPORT", index=True)
    queue: Mapped[str] = mapped_column(String(48), default="default", index=True)
    status: Mapped[str] = mapped_column(String(24), default="QUEUED", index=True)
    priority: Mapped[str] = mapped_column(String(16), default="NORMAL", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    total_units: Mapped[int] = mapped_column(Integer, default=0)
    processed_units: Mapped[int] = mapped_column(Integer, default=0)
    failed_units: Mapped[int] = mapped_column(Integer, default=0)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    started_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    finished_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, index=True)
    scheduled_for: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    initiated_by_id: Mapped[UUID | None] = fk("users.id")
    initiated_by_label: Mapped[str | None] = mapped_column(String(160))
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    scheduled_task_id: Mapped[UUID | None] = fk("scheduled_tasks.id")
    error_message: Mapped[str | None] = mapped_column(Text)
    #: Job payload and, when finished, the artefact reference a download needs.
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: Inline log lines; the job detail drawer shows them without a join.
    log_lines: Mapped[list[Any] | None] = mapped_column(JSONB)

    initiated_by = relationship("User", foreign_keys=[initiated_by_id], lazy="joined")


class ScheduledTask(Base, TimestampMixin, SoftDeleteMixin):
    """Cron-style recurring work (§11)."""

    __tablename__ = "scheduled_tasks"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    cron: Mapped[str] = mapped_column(String(64), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    job_kind: Mapped[str] = mapped_column(String(48), default="MAINTENANCE", index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    last_run_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    last_status: Mapped[str | None] = mapped_column(String(24), index=True)
    last_duration_ms: Mapped[int | None] = mapped_column(Integer)
    next_run_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    run_count: Mapped[int] = mapped_column(Integer, default=0)
    failure_count: Mapped[int] = mapped_column(Integer, default=0)
    owner_id: Mapped[UUID | None] = fk("users.id")
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class FeatureFlag(Base, TimestampMixin):
    """Feature flags with percentage and targeted rollout (§27)."""

    __tablename__ = "feature_flags"

    id: Mapped[UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String(96), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    environment: Mapped[str] = mapped_column(String(24), default="production", index=True)
    stage: Mapped[str] = mapped_column(String(24), default="BETA", index=True)
    rollout_percentage: Mapped[int] = mapped_column(Integer, default=0)
    target_user_ids: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    target_group_ids: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    target_roles: Mapped[list[str] | None] = mapped_column(ARRAY(String(48)))
    owner_id: Mapped[UUID | None] = fk("users.id")
    updated_by_id: Mapped[UUID | None] = fk("users.id")
    last_toggled_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    #: Marks a flag as experimental so navigation can badge the feature (§1).
    experimental: Mapped[bool] = mapped_column(Boolean, default=False, index=True)


class ApiClient(Base, TimestampMixin, SoftDeleteMixin):
    """A machine consumer (§25)."""

    __tablename__ = "api_clients"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    client_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="ACTIVE", index=True)
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    owner_id: Mapped[UUID | None] = fk("users.id")
    scopes: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    rate_limit_per_minute: Mapped[int] = mapped_column(Integer, default=600)
    quota_per_day: Mapped[int] = mapped_column(Integer, default=100000)
    requests_today: Mapped[int] = mapped_column(Integer, default=0)
    requests_total: Mapped[int] = mapped_column(Integer, default=0)
    error_rate: Mapped[float] = mapped_column(Numeric(6, 3), default=0)
    last_used_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    allowed_ips: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")
    credentials = relationship(
        "ApiCredential", back_populates="client", cascade="all, delete-orphan"
    )


class ApiCredential(Base, TimestampMixin):
    """A secret belonging to an API client.

    Only the hash and a 4-character prefix are stored. The plaintext exists for
    exactly one response, at creation — §76 is a schema decision here, not a UI
    one, because a column that can hold a secret eventually shows one.
    """

    __tablename__ = "api_credentials"

    id: Mapped[UUID] = uuid_pk()
    api_client_id: Mapped[UUID | None] = fk("api_clients.id", ondelete="CASCADE")
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    prefix: Mapped[str] = mapped_column(String(12), nullable=False, index=True)
    secret_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="ACTIVE", index=True)
    created_by_id: Mapped[UUID | None] = fk("users.id")
    expires_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    last_used_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    revoked_by_id: Mapped[UUID | None] = fk("users.id")
    rotated_from_id: Mapped[UUID | None] = fk("api_credentials.id")

    client = relationship("ApiClient", back_populates="credentials")


class ApiRequestLog(Base):
    """Per-request history behind the usage charts on §25."""

    __tablename__ = "api_request_logs"
    __table_args__ = (Index("ix_apilog_client_time", "api_client_id", "requested_at"),)

    id: Mapped[UUID] = uuid_pk()
    api_client_id: Mapped[UUID | None] = fk("api_clients.id", ondelete="CASCADE")
    requested_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    method: Mapped[str] = mapped_column(String(8), nullable=False)
    path: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    duration_ms: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    bytes_out: Mapped[int] = mapped_column(Integer, default=0)


class Integration(Base, TimestampMixin, SoftDeleteMixin):
    """A configured external system (§26)."""

    __tablename__ = "integrations"

    id: Mapped[UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(32), default="API", index=True)
    description: Mapped[str | None] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    status: Mapped[str] = mapped_column(String(24), default="NOT_CONFIGURED", index=True)
    health: Mapped[str] = mapped_column(String(24), default="UNKNOWN", index=True)
    last_connected_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    last_error: Mapped[str | None] = mapped_column(Text)
    last_error_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    #: Non-secret settings only. Secret values are referenced by name and live
    #: in the deployment's secret store, never in this row.
    configuration: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    required_settings: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    icon: Mapped[str | None] = mapped_column(String(48))
    docs_url: Mapped[str | None] = mapped_column(String(300))
    owner_id: Mapped[UUID | None] = fk("users.id")


class AlertRule(Base, TimestampMixin, SoftDeleteMixin):
    """Condition → action automation (§49). The condition is the same query
    tree shape the advanced search builds, so one editor serves both."""

    __tablename__ = "alert_rules"

    id: Mapped[UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    resource_type: Mapped[str] = mapped_column(String(48), default="task", index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    severity: Mapped[str] = mapped_column(String(16), default="WARNING", index=True)
    condition_tree: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    condition_text: Mapped[str | None] = mapped_column(Text)
    #: [{type: NOTIFY|EMAIL|TASK|WEBHOOK, ...}]
    actions: Mapped[list[Any] | None] = mapped_column(JSONB)
    schedule: Mapped[str] = mapped_column(String(32), default="*/15 * * * *")
    cooldown_minutes: Mapped[int] = mapped_column(Integer, default=60)
    owner_id: Mapped[UUID | None] = fk("users.id")
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    last_triggered_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    trigger_count: Mapped[int] = mapped_column(Integer, default=0)
    last_match_count: Mapped[int] = mapped_column(Integer, default=0)

    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")
    runs = relationship(
        "AlertRuleRun", back_populates="rule", cascade="all, delete-orphan",
        order_by="AlertRuleRun.started_at.desc()",
    )
    fires = relationship("AlertRuleFire", back_populates="rule", cascade="all, delete-orphan")


class SystemSetting(Base, TimestampMixin):
    """Runtime configuration (§11). One row per key so an audit entry can name
    exactly what changed, rather than diffing one giant document."""

    __tablename__ = "system_settings"

    id: Mapped[UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String(96), nullable=False, unique=True, index=True)
    category: Mapped[str] = mapped_column(String(48), default="general", index=True)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    value: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    default_value: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    value_type: Mapped[str] = mapped_column(String(24), default="string")
    #: Rendering hints for the settings form (choices, min/max, help).
    options: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    is_secret: Mapped[bool] = mapped_column(Boolean, default=False)
    requires_restart: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_by_id: Mapped[UUID | None] = fk("users.id")


class ServiceHealth(Base, TimestampMixin):
    """Last known state of each monitored dependency (§24)."""

    __tablename__ = "service_health"

    id: Mapped[UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(String(32), default="SERVICE", index=True)
    status: Mapped[str] = mapped_column(String(24), default="UNKNOWN", index=True)
    latency_ms: Mapped[float | None] = mapped_column(Numeric(10, 2))
    error_rate: Mapped[float] = mapped_column(Numeric(6, 3), default=0)
    request_volume: Mapped[int] = mapped_column(Integer, default=0)
    uptime_percent: Mapped[float] = mapped_column(Numeric(6, 3), default=100)
    last_checked_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    message: Mapped[str | None] = mapped_column(String(400))
    #: A short history so the health page can draw a sparkline per service.
    history: Mapped[list[Any] | None] = mapped_column(JSONB)


class ImportRun(Base, TimestampMixin):
    """One execution of the import wizard (§29), including its row-level
    outcome so the error report stays downloadable afterwards."""

    __tablename__ = "import_runs"

    id: Mapped[UUID] = uuid_pk()
    reference: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    target_entity: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="DRAFT", index=True)
    step: Mapped[str] = mapped_column(String(24), default="UPLOAD")
    delimiter: Mapped[str] = mapped_column(String(4), default=",")
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    valid_rows: Mapped[int] = mapped_column(Integer, default=0)
    invalid_rows: Mapped[int] = mapped_column(Integer, default=0)
    skipped_rows: Mapped[int] = mapped_column(Integer, default=0)
    imported_rows: Mapped[int] = mapped_column(Integer, default=0)
    detected_columns: Mapped[list[Any] | None] = mapped_column(JSONB)
    column_mapping: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: Row payloads held between wizard steps; cleared once executed.
    staged_rows: Mapped[list[Any] | None] = mapped_column(JSONB)
    errors: Mapped[list[Any] | None] = mapped_column(JSONB)
    created_by_id: Mapped[UUID | None] = fk("users.id")
    completed_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))


class Announcement(Base, TimestampMixin, SoftDeleteMixin, MetadataMixin):
    """A message from the platform to the people using it (§17, §34).

    Deliberately not a `Notification`. A notification is *one person's* — it is
    addressed, it is read once, and it disappears. An announcement is a
    *notice*: it is written once for many readers, it has a window during which
    it is true, and whether a given person has seen it is a fact about that
    person rather than about the notice. Modelling one as the other would mean
    either writing a row per reader at publish time — which cannot be edited
    afterwards without touching thousands of rows — or losing per-reader state
    entirely, which is the thing a maintenance notice most needs.

    So: the notice here, the reader's side of it in `AnnouncementReceipt`.

    The audience is expressed as *what a reader is*, never as a list of people:
    an empty `audience_roles` means everyone, and an `organization_id` scopes it
    to one tenant. A notice addressed by enumerating recipients is a notice
    that silently misses whoever joined after it was written.
    """

    __tablename__ = "announcements"
    __table_args__ = (
        # The one query this table exists to answer: what is live now.
        Index("ix_announcement_live", "status", "publish_at", "expires_at"),
    )

    id: Mapped[UUID] = uuid_pk()
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    #: What sort of notice it is: RELEASE, MAINTENANCE, INCIDENT, POLICY, NEWS.
    category: Mapped[str] = mapped_column(String(24), default="NEWS", index=True)
    #: How loudly to say it: INFO, WARNING, CRITICAL — the same three words
    #: notifications use, so one reader learns one vocabulary.
    severity: Mapped[str] = mapped_column(String(16), default="INFO", index=True)
    #: DRAFT → SCHEDULED → PUBLISHED → ARCHIVED. `EXPIRED` is *derived* from
    #: `expires_at` rather than stored: a status that has to be swept by a job
    #: is a status that is wrong between sweeps.
    status: Mapped[str] = mapped_column(String(16), default="DRAFT", index=True)
    publish_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    expires_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    #: Empty means every role. Roles rather than users — see the class docstring.
    audience_roles: Mapped[list[str] | None] = mapped_column(ARRAY(String(48)))
    #: `None` means every organization.
    organization_id: Mapped[UUID | None] = fk("organizations.id")
    #: A notice that asks for a response rather than merely being readable.
    requires_acknowledgement: Mapped[bool] = mapped_column(Boolean, default=False)
    #: Held at the top of the list while it is live, for the one that matters.
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    #: Where to go to act on it. A notice you cannot act on is noise (§66).
    link: Mapped[str | None] = mapped_column(String(500))
    author_id: Mapped[UUID | None] = fk("users.id")
    author_label: Mapped[str | None] = mapped_column(String(160))

    receipts = relationship(
        "AnnouncementReceipt",
        back_populates="announcement",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class AnnouncementReceipt(Base, TimestampMixin):
    """One reader's side of one notice (§17).

    Written when somebody reads or acknowledges, never at publish time: a
    receipt per reader created up front is a table that grows with
    (notices × people) whether or not anybody looked, and it makes editing a
    published notice a write to every one of those rows.

    Reading and acknowledging are two columns rather than one status, because
    they are two different facts and a maintenance notice needs both: "everyone
    has seen it" and "eleven people have agreed to it" are different questions.
    """

    __tablename__ = "announcement_receipts"
    __table_args__ = (
        Index(
            "ux_announcement_receipt",
            "announcement_id",
            "user_id",
            unique=True,
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    announcement_id: Mapped[UUID] = fk("announcements.id", ondelete="CASCADE", nullable=False)
    user_id: Mapped[UUID] = fk("users.id", ondelete="CASCADE", nullable=False)
    read_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    acknowledged_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))

    announcement = relationship("Announcement", back_populates="receipts")


class AlertRuleRun(Base, TimestampMixin):
    """One evaluation of a rule: what it matched, what it did, what it held back.

    Append-only, and the thing the workflow page actually shows — "it ran, it
    matched eleven tickets, it acted on two and the cooldown held back nine" is
    the only answer that makes an automation trustworthy. A rule that reported
    nothing but its own `last_triggered_at` is a rule nobody can audit.

    `detail` carries a *bounded sample* of the per-record outcomes rather than
    all of them: the counts beside it are the summary, and a sample is not a
    second copy of them. Five hundred matched records would otherwise put five
    hundred objects in a column that gets read on a list screen.
    """

    __tablename__ = "alert_rule_runs"
    __table_args__ = (Index("ix_alert_run_rule_time", "rule_id", "started_at"),)

    id: Mapped[UUID] = uuid_pk()
    rule_id: Mapped[UUID] = fk("alert_rules.id", ondelete="CASCADE", nullable=False)
    #: A dry run evaluates and reports; it writes no notification, no task, no
    #: email and no cooldown. Recorded so the history distinguishes "we tried
    #: it" from "it happened".
    dry_run: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    #: Who asked. Null once a scheduler runs it unattended (§23).
    triggered_by_id: Mapped[UUID | None] = fk("users.id")
    started_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), index=True)
    finished_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    matched: Mapped[int] = mapped_column(Integer, default=0)
    fired: Mapped[int] = mapped_column(Integer, default=0)
    #: Matched, and deliberately not acted on because this record was acted on
    #: within the cooldown. The number that answers "why did it go quiet".
    suppressed: Mapped[int] = mapped_column(Integer, default=0)
    #: Matched, within neither cooldown nor this run's fire budget — they wait
    #: for the next run rather than being dropped.
    deferred: Mapped[int] = mapped_column(Integer, default=0)
    #: Per-action tallies and a sample of the records, for the run drawer.
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: Set when the *evaluation* failed — a condition naming a field that has
    #: since been renamed, say. An action that failed is in `detail`: one
    #: unreachable webhook must not lose the notification beside it.
    error: Mapped[str | None] = mapped_column(Text)

    rule = relationship("AlertRule", back_populates="runs")
    triggered_by = relationship("User", foreign_keys=[triggered_by_id], lazy="joined")


class AlertRuleFire(Base, TimestampMixin):
    """When a rule last acted on one record — the cooldown ledger.

    **Keyed per record, which is the whole point.** A cooldown held against the
    *rule* would let one run send forty messages about forty breached tickets
    and then go silent about the forty-first; §49 asks for the opposite. So the
    unit of "we have already said this" is the pair, and one row per pair is
    upserted rather than appended: this table is state, not history, and its
    size is bounded by rules × records instead of growing with every run.

    `record_id` is text because the ledger outlives the record. A rule that
    acted on a ticket somebody then deleted must still remember that it did,
    and a foreign key would either block the delete or erase the memory.
    """

    __tablename__ = "alert_rule_fires"
    __table_args__ = (
        UniqueConstraint("rule_id", "record_id", name="uq_alert_fire_record"),
        Index("ix_alert_fire_recent", "rule_id", "last_fired_at"),
    )

    id: Mapped[UUID] = uuid_pk()
    rule_id: Mapped[UUID] = fk("alert_rules.id", ondelete="CASCADE", nullable=False)
    record_id: Mapped[str] = mapped_column(String(64), nullable=False)
    #: What the record was called when it last fired, so the history reads as
    #: sentences after the record has moved on.
    record_label: Mapped[str | None] = mapped_column(String(240))
    #: The cooldown reads *this*, not the mixin's `updated_at`: correcting a
    #: record's label is a write to the row and must not extend a silence.
    last_fired_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True))
    fire_count: Mapped[int] = mapped_column(Integer, default=0)

    rule = relationship("AlertRule", back_populates="fires")
