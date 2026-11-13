"""Seed data for records analytics: SEED, MARK, DEMO_PASSWORD."""

from __future__ import annotations

from sqlalchemy import func, select

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


def _persona(session, username: str):
    from src.models.identity import User

    return session.scalars(select(User).where(User.username == username)).first()


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
