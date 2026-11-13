"""Seed data for records analytics: populate."""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select

from src.core.clock import now
from src.seed.records_analytics.drop_notifications import (
    CHURN_REASONS,
    CONTRACT_TITLES,
    DEMO_PASSWORD,
    SEED,
    SEGMENT_VALUE,
    TERMS,
    _persona,
)
from src.seed.records_analytics.histories import _histories, _watches
from src.seed.records_analytics.snapshots import _audit, _snapshots, _staff


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
