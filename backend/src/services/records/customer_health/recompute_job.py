"""Recomputing scores (the daily job) and alerting on band drops."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, select

from src.core.clock import now
from src.services.analytics import jobs as analytics_jobs
from src.services.records.customer_health.inputs import gather
from src.services.records.customer_health.scoring import score
from src.services.records.customer_health.scoring_model import (
    BAND_LABELS,
    BANDS,
    CONFIGURE,
    SIGNALS,
    active_model,
)


@analytics_jobs.runner("analytics.customer-health")
def _daily_job(session) -> tuple[dict[str, Any], str, int]:
    outcome = recompute(session, notify=True)
    line = (f"{outcome['customers']} customer(s) scored, {outcome['dropped']} dropped a band, "
            f"{outcome['improved']} improved")
    return outcome, line, outcome["customers"]


def recompute(session, *, principal=None, notify: bool = True, customer_ids: list[UUID] | None = None,
              today: datetime | None = None) -> dict[str, Any]:
    """Score every customer (or the ones named), snapshot today, report changes."""
    from src.models.records_analytics import CustomerHealth, CustomerHealthSnapshot

    if principal is not None:
        principal.require(CONFIGURE)
    moment = today or now()
    model = active_model(session)
    inputs = gather(session, today=moment, thresholds=model.thresholds or {}, customer_ids=customer_ids)
    if not inputs:
        return {"customers": 0, "dropped": 0, "improved": 0, "computed_at": moment.isoformat()}

    current = {
        row.customer_id: row
        for row in session.scalars(select(CustomerHealth).where(CustomerHealth.customer_id.in_(list(inputs))))
    }
    day = moment.date()
    snapshots = {
        row.customer_id: row
        for row in session.scalars(
            select(CustomerHealthSnapshot).where(
                CustomerHealthSnapshot.customer_id.in_(list(inputs)), CustomerHealthSnapshot.day == day,
            )
        )
    }
    history = _scores_on(session, list(inputs), (day - timedelta(days=7), day - timedelta(days=30)))

    dropped: list[tuple[UUID, str, str, int]] = []
    improved = 0
    for customer_id, values in inputs.items():
        result = score(values, model.weights, model.thresholds or {}, today=moment)
        row = current.get(customer_id)
        if row is None:
            row = CustomerHealth(customer_id=customer_id, score=result["score"], band=result["band"])
            session.add(row)
        else:
            if row.band != result["band"]:
                if BANDS.index(result["band"]) > BANDS.index(row.band):
                    dropped.append((customer_id, row.band, result["band"], result["score"]))
                else:
                    improved += 1
                row.previous_band = row.band
                row.band_changed_at = moment
        row.score = result["score"]
        row.band = result["band"]
        row.components = result["components"]
        row.computed_at = moment
        week, month = history.get(customer_id, {}).get(0), history.get(customer_id, {}).get(1)
        row.delta_7d = None if week is None else result["score"] - week
        row.delta_30d = None if month is None else result["score"] - month

        compact = {key: result["components"][key]["score"] for key in SIGNALS}
        snapshot = snapshots.get(customer_id)
        if snapshot is None:
            session.add(CustomerHealthSnapshot(
                customer_id=customer_id, day=day, score=result["score"], band=result["band"], components=compact,
            ))
        else:
            snapshot.score, snapshot.band, snapshot.components = result["score"], result["band"], compact
    session.flush()

    if notify and dropped:
        _alert_drops(session, dropped)
    return {
        "customers": len(inputs),
        "dropped": len(dropped),
        "improved": improved,
        "computed_at": moment.isoformat(),
    }


def _scores_on(session, ids: list[UUID], days: tuple[date, ...]) -> dict[UUID, dict[int, int]]:
    """Each customer's snapshot score on each of `days` (by index), or the nearest before."""
    from src.models.records_analytics import CustomerHealthSnapshot

    out: dict[UUID, dict[int, int]] = {}
    for index, day in enumerate(days):
        latest = (
            select(CustomerHealthSnapshot.customer_id, func.max(CustomerHealthSnapshot.day).label("day"))
            .where(CustomerHealthSnapshot.customer_id.in_(ids), CustomerHealthSnapshot.day <= day,
                   CustomerHealthSnapshot.day >= day - timedelta(days=7))
            .group_by(CustomerHealthSnapshot.customer_id)
            .subquery()
        )
        rows = session.execute(
            select(CustomerHealthSnapshot.customer_id, CustomerHealthSnapshot.score)
            .join(latest, and_(latest.c.customer_id == CustomerHealthSnapshot.customer_id,
                               latest.c.day == CustomerHealthSnapshot.day))
        )
        for customer_id, value in rows:
            out.setdefault(customer_id, {})[index] = int(value)
    return out


def _alert_drops(session, dropped: list[tuple[UUID, str, str, int]]) -> int:
    """An in-app notification per customer that moved to a worse band."""
    from src.models.business import Customer
    from src.models.identity import Role, User
    from src.services.collaboration import notifications

    customers = {
        row.id: row for row in session.scalars(select(Customer).where(Customer.id.in_([d[0] for d in dropped])))
    }
    configurers: list[UUID] | None = None
    sent = 0
    for customer_id, before, after, value in dropped:
        customer = customers.get(customer_id)
        if customer is None:  # pragma: no cover - deleted between gather and alert
            continue
        recipients = [customer.account_manager_id] if customer.account_manager_id else None
        if not recipients:
            if configurers is None:
                roles = [r.code for r in session.scalars(select(Role)) if CONFIGURE in (r.permissions or [])]
                configurers = list(session.scalars(
                    select(User.id).join(Role, Role.id == User.role_id).where(Role.code.in_(roles), User.deleted_at.is_(None))
                ).all()) if roles else []
            recipients = configurers
        for user_id in recipients:
            notifications.publish(
                session, user_id=user_id, category="ALERT",
                severity="CRITICAL" if after == "CRITICAL" else "WARNING",
                title=f"{customer.name} dropped to {BAND_LABELS[after].lower()}",
                body=f"Health score {value} — was {BAND_LABELS[before].lower()}.",
                link=f"/customers/{customer_id}?tab=health",
                icon="heart", resource_type="customer", resource_id=str(customer_id),
                group_key=f"health:{customer_id}",
                metadata={"from": before, "to": after, "score": value},
            )
            sent += 1
    return sent
