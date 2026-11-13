"""Records & analytics demo data (§12, §13, §17, §22, §25).

Runs after the main graph, against the session, because everything here is
*about* records that already exist:

* **Contracts** for most active accounts — end dates spread from four months
  ago to ten months out, in the stage a real pipeline would have them in, with
  a create and a few stage moves in the audit trail each.
* **Customer health** — today's scores computed by the real model, and ninety
  days of daily snapshots behind them: mostly gentle drift, some accounts that
  slid into a worse band in the last weeks (the portfolio's movers and the
  drop alerts), some recovering.
* **Version histories** — a handful of customers, tickets, tasks, orders,
  devices and projects get a chain of edits that ends exactly at their current
  values, so the History panel has something to compare and restore.
* **Metric watches** — six watches over tickets, orders and devices, each
  backfilled by the real detector, so the alert list has history.
* **Public links** — two links to an administrator's dashboard, one open and
  one behind the password `nucleus-demo`.

Dates are relative to now. Idempotent, so the same function is the
`--sync-analytics` repair for a database seeded before these features: each
part only adds what is missing (marked `source: records-analytics-seed`).
"""

from __future__ import annotations

import random
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select

from src.core.clock import now

SEED = 20261113
MARK = {"source": "records-analytics-seed"}
DEMO_PASSWORD = "nucleus-demo"

CONTRACT_TITLES = (
    "Platform subscription", "Enterprise licence", "Support & maintenance", "Managed devices",
    "Analytics add-on", "Premium SLA", "Field service agreement", "Data integration package",
)
SEGMENT_VALUE = {
    "SMB": (6_000, 28_000), "MID_MARKET": (28_000, 95_000),
    "ENTERPRISE": (95_000, 420_000), "STRATEGIC": (300_000, 1_200_000),
}
TERMS = (
    "Annual subscription billed in advance. Price protected for the term; uplift capped at CPI + 3% on renewal.",
    "Three-year commitment with annual true-up. Termination for convenience with 90 days' notice after year one.",
    "Includes 24/7 priority support, a named success manager and quarterly business reviews.",
    "Device fleet managed on a per-unit basis; volume tier re-assessed at each renewal.",
)
CHURN_REASONS = ("Budget cut", "Moved to a competitor", "Consolidated vendors", "Project cancelled")

WATCHES = (
    {"name": "New tickets per week", "dataset": "ticket", "measure": "count", "granularity": "week",
     "method": "zscore", "sensitivity": "medium", "window": 8,
     "description": "Support volume — a sudden jump usually means an incident or a release gone wrong."},
    {"name": "Critical tickets per day", "dataset": "ticket", "measure": "count", "granularity": "day",
     "method": "zscore", "sensitivity": "high", "window": 14, "filters": {"priority": "CRITICAL"},
     "direction": "up", "channels": ["in_app", "email"],
     "description": "Priority-one work raised per day; spikes only."},
    {"name": "Order revenue per week", "dataset": "order", "measure": "sum", "measure_field": "total",
     "granularity": "week", "method": "zscore", "sensitivity": "medium", "window": 10,
     "description": "Booked revenue, so a drop is caught before month-end."},
    {"name": "Orders placed per day", "dataset": "order", "measure": "count", "granularity": "day",
     "method": "seasonal", "sensitivity": "medium", "window": 14,
     "description": "Compared with the same weekday in earlier weeks, so Mondays are not spikes."},
    {"name": "Escalated tickets per week", "dataset": "ticket", "measure": "count", "granularity": "week",
     "method": "zscore", "sensitivity": "low", "window": 8, "filters": {"status": "ESCALATED"},
     "description": "Escalations, judged loosely — only the clear outliers."},
    {"name": "Device errors reported per week", "dataset": "device", "measure": "sum",
     "measure_field": "error_count", "date_field": "last_seen_at", "granularity": "week",
     "method": "zscore", "sensitivity": "medium", "window": 8, "direction": "up",
     "description": "Fleet errors by the week devices last checked in."},
)


def populate(session) -> dict[str, int]:
    """Add what is missing. Safe to run again."""
    from src.services.analytics import jobs as analytics_jobs
    from src.services.records import customer_health

    counts: dict[str, int] = {}
    customer_health.active_model(session)
    counts["contracts"] = _contracts(session)
    counts["health_scores"] = customer_health.recompute(session, notify=False)["customers"]
    counts["health_snapshots"] = _snapshots(session)
    counts["version_histories"] = _histories(session)
    counts["metric_watches"] = _watches(session)
    counts["public_links"] = _links(session)
    analytics_jobs.ensure_jobs(session)
    session.flush()
    return counts


def seed_safely(session) -> None:
    """From the main seed: a demo nicety must never fail the whole run."""
    try:
        with session.begin_nested():
            populate(session)
    except Exception as exc:  # pragma: no cover - defensive
        from framework.commons.logger import logger as log

        log.info(f"records & analytics seed skipped: {exc}", "yellow")


# ── people ───────────────────────────────────────────────────────────────


def _persona(session, username: str):
    from src.models.identity import User

    return session.scalars(select(User).where(User.username == username)).first()


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


# ── contracts ────────────────────────────────────────────────────────────


def _contracts(session) -> int:
    from src.models.business import Customer
    from src.models.records_analytics import Contract
    from src.services.records import contracts as service

    if session.scalar(select(func.count()).select_from(Contract)):
        return 0
    rng = random.Random(SEED)
    today = now().date()
    staff = _staff(session)
    customers = session.scalars(
        select(Customer).where(Customer.deleted_at.is_(None), Customer.status == "ACTIVE")
        .order_by(Customer.lifetime_value.desc())
    ).unique().all()[:90]
    made = 0
    ranks: dict[str, float] = {}
    for index, customer in enumerate(customers):
        offset = rng.randint(-120, 300)
        end = today + timedelta(days=offset)
        term = rng.choice((12, 12, 12, 24, 36))
        start = end - timedelta(days=round(term * 30.44))
        low, high = SEGMENT_VALUE.get(customer.segment, SEGMENT_VALUE["SMB"])
        value = Decimal(rng.randrange(low, high, 500)).quantize(Decimal("0.01"))
        if offset < 0:
            stage = "RENEWED" if rng.random() < 0.75 else "CHURNED"
        elif offset <= 30:
            stage = rng.choice(("COMMITTED", "COMMITTED", "NEGOTIATION"))
        elif offset <= 120:
            stage = rng.choice(("NEGOTIATION", "NEGOTIATION", "UPCOMING", "COMMITTED"))
        else:
            stage = "UPCOMING"
        probability = service.DEFAULT_PROBABILITY[stage] + (rng.randint(-15, 10) if stage in service.OPEN_STAGES else 0)
        owner = None
        if customer.account_manager_id:
            owner = next((u for u in staff if u.id == customer.account_manager_id), None)
        owner = owner or rng.choice(staff)
        ranks[stage] = ranks.get(stage, 0) + 1024
        row = Contract(
            reference=f"CTR-{index + 1:05d}",
            title=f"{customer.name} — {rng.choice(CONTRACT_TITLES)}",
            customer_id=customer.id, owner_id=owner.id, value=value, currency="EUR",
            start_date=start, end_date=end, term_months=term,
            billing=rng.choice(("ANNUAL", "ANNUAL", "QUARTERLY", "MONTHLY")),
            auto_renew=rng.random() < 0.3, notice_days=rng.choice((30, 60, 60, 90)),
            stage=stage, probability=max(5, min(100, probability)), rank=ranks[stage],
            terms=rng.choice(TERMS), notes=None,
            churn_reason=rng.choice(CHURN_REASONS) if stage == "CHURNED" else None,
        )
        created = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc) - timedelta(days=rng.randint(3, 20))
        row.created_at = created
        moved = datetime.combine(min(today, end - timedelta(days=rng.randint(5, 60))),
                                 datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=rng.randint(9, 17))
        moved = max(moved, created + timedelta(days=1))
        row.stage_changed_at = moved
        if stage in service.CLOSED_STAGES:
            row.closed_at = moved
        session.add(row)
        session.flush()

        # The trail: created as upcoming, then walked to where it is now.
        path = {"UPCOMING": ["UPCOMING"], "NEGOTIATION": ["UPCOMING", "NEGOTIATION"],
                "COMMITTED": ["UPCOMING", "NEGOTIATION", "COMMITTED"],
                "RENEWED": ["UPCOMING", "NEGOTIATION", "COMMITTED", "RENEWED"],
                "CHURNED": ["UPCOMING", "NEGOTIATION", "CHURNED"]}[stage]
        state = service.state(row)
        initial = {**state, "stage": "UPCOMING", "probability": service.DEFAULT_PROBABILITY["UPCOMING"],
                   "churn_reason": None}
        _audit(session, at=created, action="CREATE", resource_type="contract", resource_id=row.id,
               label=row.reference, actor=owner, before=None, after=initial,
               message=f"created contract {row.reference} — {row.title}")
        steps = path[1:]
        previous = initial
        for number, step in enumerate(steps, start=1):
            at = created + (moved - created) * number / len(steps)
            after = {**previous, "stage": step,
                     "probability": state["probability"] if step == stage else service.DEFAULT_PROBABILITY[step]}
            if step == "CHURNED":
                after["churn_reason"] = state["churn_reason"]
            changed = {k for k in after if after[k] != previous.get(k)}
            _audit(session, at=at, action="STATUS_CHANGE", resource_type="contract", resource_id=row.id,
                   label=row.reference, actor=owner,
                   before={k: previous.get(k) for k in changed}, after={k: after[k] for k in changed},
                   message=f"moved {row.reference} to {service.STAGE_LABELS[step].lower()}")
            previous = after
        made += 1
    session.flush()
    return made


# ── health history ───────────────────────────────────────────────────────


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


def _drop_notifications(session) -> int:
    """The alerts a few of those slides would have raised, if not already sent."""
    from src.models.business import Customer
    from src.models.platform import Notification
    from src.models.records_analytics import CustomerHealth
    from src.services.records import customer_health

    if session.scalar(select(func.count()).select_from(Notification).where(Notification.group_key.like("health:%"))):
        return 0
    admin = _persona(session, "admin")
    manager = _persona(session, "manager")
    drops = session.execute(
        select(CustomerHealth, Customer).join(Customer, Customer.id == CustomerHealth.customer_id)
        .where(CustomerHealth.previous_band.is_not(None), CustomerHealth.band_changed_at.is_not(None))
        .order_by(CustomerHealth.band_changed_at.desc())
    ).all()
    sent = 0
    for health, customer in drops:
        if customer_health.BANDS.index(health.band) <= customer_health.BANDS.index(health.previous_band):
            continue
        for person in {p.id: p for p in (admin, manager) if p}.values():
            session.add(Notification(
                user_id=person.id, category="ALERT",
                severity="CRITICAL" if health.band == "CRITICAL" else "WARNING",
                title=f"{customer.name} dropped to {customer_health.BAND_LABELS[health.band].lower()}",
                body=f"Health score {health.score} — was {customer_health.BAND_LABELS[health.previous_band].lower()}.",
                icon="heart", link=f"/customers/{customer.id}?tab=health", resource_type="customer",
                resource_id=str(customer.id), group_key=f"health:{customer.id}",
                is_read=sent > 2, created_at=health.band_changed_at,
                metadata_json={"from": health.previous_band, "to": health.band, "score": health.score},
            ))
            sent += 1
        if sent >= 10:
            break
    session.flush()
    return sent


# ── version histories ────────────────────────────────────────────────────

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


def _histories(session) -> int:
    from src.models.platform import AuditLog
    from src.services.records import writes as record_writes
    from src.services.records.explorer import resource_for

    if session.scalar(select(func.count()).select_from(AuditLog).where(
            AuditLog.metadata_json["source"].astext == MARK["source"], AuditLog.resource_type != "contract")):
        return 0
    rng = random.Random(SEED + 2)
    staff = [u for u in _staff(session)][:12] or [None]
    audited = set(session.scalars(select(AuditLog.resource_id).where(AuditLog.resource_id.is_not(None))).all())
    anchor = now()
    made = 0
    for key, edits in _EDITS.items():
        resource = resource_for(key)
        rows = [r for r in session.scalars(
            select(resource.model).where(resource.model.deleted_at.is_(None))
            .order_by(resource.model.updated_at.desc()).limit(40)
        ).unique().all() if str(r.id) not in audited][:3]
        for row in rows:
            current = record_writes._state(resource, row)
            state = dict(current)
            steps = rng.randint(4, 6)
            moment = anchor - timedelta(hours=rng.randint(2, 30))
            chain = []
            for _ in range(steps):
                field, choices = rng.choice([e for e in edits if e[0] in state])
                old = _earlier(state[field], choices, rng, field)
                if old == state[field]:
                    continue
                others = rng.sample([e for e in edits if e[0] != field and e[0] in state], k=min(1, len(edits) - 1))
                change_before = {field: old}
                change_after = {field: state[field]}
                if others and rng.random() < 0.4:
                    second = others[0][0]
                    older = _earlier(state[second], others[0][1], rng, second)
                    if older != state[second]:
                        change_before[second] = older
                        change_after[second] = state[second]
                chain.append((moment, change_before, change_after))
                state.update(change_before)
                moment -= timedelta(days=rng.randint(1, 9), hours=rng.randint(0, 20))
            created_at = min(row.created_at or moment, moment - timedelta(days=2))
            actor = rng.choice(staff)
            label = resource.label_for(row)
            _audit(session, at=created_at, action="CREATE", resource_type=key, resource_id=row.id, label=label,
                   actor=actor, before=None, after=dict(state), message=f"created {label}")
            for at, before, after in reversed(chain):
                status_only = set(before) == {resource.status_field}
                _audit(session, at=at, action="STATUS_CHANGE" if status_only else "UPDATE", resource_type=key,
                       resource_id=row.id, label=label, actor=rng.choice(staff), before=before, after=after,
                       message=(f"moved {label} to {after[resource.status_field]}" if status_only
                                else f"updated {label} ({', '.join(sorted(after))})"))
            made += 1
    session.flush()
    return made


# ── metric watches ───────────────────────────────────────────────────────


def _watches(session) -> int:
    from src.models.records_analytics import MetricWatch
    from src.services.analytics import metric_watches

    if session.scalar(select(func.count()).select_from(MetricWatch)):
        return 0
    owner = _persona(session, "admin") or (_staff(session) or [None])[0]
    manager = _persona(session, "manager")
    made = 0
    for spec in WATCHES:
        row = MetricWatch(
            name=spec["name"], description=spec.get("description"), dataset=spec["dataset"],
            measure=spec["measure"], measure_field=spec.get("measure_field"), date_field=spec.get("date_field"),
            filters=spec.get("filters") or {}, granularity=spec["granularity"], method=spec["method"],
            sensitivity=spec["sensitivity"], direction=spec.get("direction", "both"), window=spec["window"],
            channels=spec.get("channels", ["in_app"]), recipient_ids=[str(manager.id)] if manager else [],
            enabled=True, muted=False, owner_id=owner.id if owner else None,
        )
        session.add(row)
        session.flush()
        metric_watches.evaluate(session, row, backfill=True, notify=False)
        made += 1
    # One snoozed, so the list shows what that looks like.
    snoozed = session.scalars(select(MetricWatch).where(MetricWatch.name == "Escalated tickets per week")).first()
    if snoozed is not None:
        snoozed.snoozed_until = now() + timedelta(days=2)
    session.flush()
    return made


# ── public links ─────────────────────────────────────────────────────────


def _links(session) -> int:
    from werkzeug.security import generate_password_hash

    from src.models.personal import Dashboard
    from src.models.records_analytics import DashboardLink

    if session.scalar(select(func.count()).select_from(DashboardLink)):
        return 0
    admin = _persona(session, "admin")
    if admin is None:
        return 0
    dashboard = session.scalars(
        select(Dashboard).where(Dashboard.owner_id == admin.id, Dashboard.deleted_at.is_(None))
        .order_by(Dashboard.created_at)
    ).first()
    if dashboard is None:
        return 0
    rng = random.Random(SEED + 3)
    open_link = DashboardLink(
        dashboard_id=dashboard.id, token=f"demo-{rng.getrandbits(96):024x}", label="Board pack (open)",
        created_by_id=admin.id, view_count=37, password_version=0, allow_embed=True,
        allowed_origins=["https://intranet.nucleus.example"], last_viewed_at=now() - timedelta(hours=3),
        expires_at=now() + timedelta(days=30),
    )
    locked = DashboardLink(
        dashboard_id=dashboard.id, token=f"demo-{rng.getrandbits(96):024x}", label="Investors (password)",
        created_by_id=admin.id, view_count=9, password_version=1,
        password_hash=generate_password_hash(DEMO_PASSWORD), allow_embed=False,
        last_viewed_at=now() - timedelta(days=1, hours=5), expires_at=now() + timedelta(days=14),
    )
    session.add_all([open_link, locked])
    session.flush()
    return 2
