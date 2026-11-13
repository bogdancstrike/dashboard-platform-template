"""Seed data for records analytics: _snapshots, _earlier, _EDITS."""

from __future__ import annotations

import random
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.seed.records_analytics.drop_notifications import (
    MARK,
    SEED,
    _drop_notifications,
)


def _staff(session) -> list[Any]:
    from src.models.identity import User

    return list(session.scalars(
        select(User).where(User.deleted_at.is_(None)).order_by(User.username).limit(40)
    ).all())


def _audit(session, *, at: datetime, action: str, resource_type: str, resource_id, label: str,
           actor, before: dict[str, Any] | None, after: dict[str, Any] | None, message: str,
           metadata: dict[str, Any] | None = None) -> None:
    """An audit row dated in the past, with the diff computed as `core/audit` would."""
    from src.core.audit import diff, redact
    from src.models.platform import AuditLog

    changes = diff(before, after)
    session.add(AuditLog(
        occurred_at=at, created_at=at, updated_at=at, action=action, resource_type=resource_type,
        resource_id=str(resource_id), resource_label=label[:255],
        actor_id=actor.id if actor else None, actor_label=(actor.full_name if actor else "System")[:160],
        actor_role=(actor.role.code if actor and actor.role else "SYSTEM"), result="SUCCESS",
        ip_address="10.0.4.12", user_agent="Mozilla/5.0", message=message[:500],
        state_before=redact(before) or None, state_after=redact(after) or None,
        changed_fields=list(changes) or None, changes=changes or None,
        metadata_json={**MARK, **(metadata or {})}, impersonated=False,
    ))


def _snapshots(session) -> int:
    """Ninety days of daily scores behind today's, for every customer missing them."""
    from src.models.records_analytics import CustomerHealth, CustomerHealthSnapshot
    from src.services.records import customer_health

    rng = random.Random(SEED + 1)
    today = now().date()
    have = set(session.scalars(
        select(CustomerHealthSnapshot.customer_id).where(CustomerHealthSnapshot.day < today).distinct()
    ).all())
    model = customer_health.active_model(session)
    thresholds = customer_health._merged(customer_health.DEFAULT_THRESHOLDS, model.thresholds or {})
    rows = session.scalars(select(CustomerHealth).order_by(CustomerHealth.customer_id)).all()
    made = 0
    for row in rows:
        if row.customer_id in have:
            continue
        story = rng.random()
        current = row.score
        # Walk backwards from today. A "slider" was markedly healthier two to
        # five weeks ago; a "recoverer" was markedly worse; most just drift.
        turn = rng.randint(10, 35)
        if story < 0.16:
            shift = rng.randint(14, 26)
        elif story < 0.26:
            shift = -rng.randint(12, 22)
        else:
            shift = 0
        level = float(current)
        series: list[tuple[date, int]] = []
        for back in range(1, 91):
            target = current + (shift if back >= turn else shift * back / turn)
            level += (target - level) * 0.35 + rng.uniform(-2.2, 2.2)
            series.append((today - timedelta(days=back), int(round(max(3, min(98, level))))))
        components = {key: row.components[key]["score"] for key in customer_health.SIGNALS} if row.components else None
        for day, value in series:
            session.add(CustomerHealthSnapshot(
                customer_id=row.customer_id, day=day, score=value,
                band=customer_health.band_for(value, thresholds), components=components,
            ))
            made += 1
        week = dict(series)[today - timedelta(days=7)]
        month = dict(series)[today - timedelta(days=30)]
        row.delta_7d, row.delta_30d = current - week, current - month
        # The band it was in before the turn, and when it changed.
        before_band = customer_health.band_for(dict(series)[today - timedelta(days=min(89, turn + 3))], thresholds)
        if before_band != row.band:
            row.previous_band = before_band
            row.band_changed_at = datetime.combine(today - timedelta(days=rng.randint(1, max(1, turn - 1))),
                                                   datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=2, minutes=15)
        else:
            row.previous_band, row.band_changed_at = None, None
    session.flush()
    _drop_notifications(session)
    return made


#: Per dataset, the fields an edit chain may touch and plausible earlier values.
_EDITS: dict[str, list[tuple[str, list[Any]]]] = {
    "customer": [("segment", ["SMB", "MID_MARKET", "ENTERPRISE"]), ("status", ["ACTIVE", "INACTIVE"]),
                 ("lifecycle_stage", ["PROSPECT", "CUSTOMER", "RENEWAL"]), ("satisfaction", [5, 6, 7, 8, 9]),
                 ("city", ["Berlin", "Lisbon", "Vienna", "Rotterdam"]), ("email", None)],
    "ticket": [("status", ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_CUSTOMER"]),
               ("priority", ["LOW", "NORMAL", "HIGH"]), ("severity", ["MINOR", "MODERATE", "MAJOR"]),
               ("category", ["SUPPORT", "BUG", "BILLING", "ACCESS"]), ("subject", None)],
    "task": [("status", ["NEW", "ASSIGNED", "IN_PROGRESS", "IN_REVIEW"]), ("priority", ["LOW", "NORMAL", "HIGH"]),
             ("progress", [0, 10, 25, 40, 60]), ("estimate_hours", [4, 6, 8, 12, 16]), ("title", None)],
    "order": [("status", ["PENDING", "CONFIRMED", "PROCESSING"]), ("payment_status", ["UNPAID", "PARTIAL"]),
              ("fulfilment_status", ["PENDING", "SHIPPED"]), ("notes", None)],
    "device": [("status", ["ONLINE", "DEGRADED", "MAINTENANCE"]), ("location", None),
               ("battery_percent", [35, 52, 68, 81, 94]), ("error_count", [0, 1, 2, 4])],
    "project": [("health", ["ON_TRACK", "AT_RISK"]), ("phase", ["DESIGN", "EXECUTION"]),
                ("priority", ["NORMAL", "HIGH"]), ("progress", [10, 25, 40, 55]), ("description", None)],
}


def _earlier(value: Any, choices: list[Any] | None, rng: random.Random, field: str) -> Any:
    if choices:
        options = [c for c in choices if c != value]
        return rng.choice(options) if options else value
    if isinstance(value, str) and value:
        if field == "email":
            return value.replace("@", ".old@", 1)
        if field in ("subject", "title"):
            return value.rsplit(" ", 1)[0] if " " in value else f"{value} (draft)"
        return f"{value} — earlier wording"
    return "Earlier note from the account review." if field in ("notes", "description") else value
