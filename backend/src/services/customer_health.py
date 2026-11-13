"""Customer health (§12): a weighted model from tickets, orders and usage, with trend.

**The model is four signals and their weights.** Each signal is scored 0–100
on its own — *tickets* (open, escalated and SLA-breached work), *orders*
(recency, and volume and value against the previous window), *usage* (the
share of the customer's devices online, and how recently anybody spoke to
them) and *renewal* (how close the next contract end is, and how likely it is
to renew). The overall score is the weighted mean, and a band comes from two
cut-offs. Weights and every parameter are an administrator's (`health.configure`),
stored in `health_models` and audited.

**Computed in bulk, in PostgreSQL.** One grouped query per signal for every
customer at once, not four queries per customer: three hundred accounts is
four statements, which is what lets "recompute now" be a button rather than a
job somebody waits on.

**The "why" is part of the answer.** Each signal carries its inputs and the
sentences that explain its score ("2 tickets breached their SLA: −24"), so the
customer page shows the breakdown the number came from rather than asking the
reader to trust it.

**Trend is snapshots.** One row per customer per day (`customer_health_snapshots`),
upserted by every recompute; deltas over 7 and 30 days and the portfolio's
movers are read from them.

**A drop in band is news.** When a recompute moves a customer to a worse band,
their account manager (or, with none, every holder of `health.configure`) gets
an in-app notification linking to the customer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import and_, case, func, or_, select

from src.core import audit
from src.core.clock import now
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid

VIEW = "records.view"
CONFIGURE = "health.configure"

BANDS = ("HEALTHY", "AT_RISK", "CRITICAL")
BAND_LABELS = {"HEALTHY": "Healthy", "AT_RISK": "At risk", "CRITICAL": "Critical"}
SIGNALS = ("tickets", "orders", "usage", "renewal")
SIGNAL_LABELS = {
    "tickets": "Support tickets",
    "orders": "Orders",
    "usage": "Usage",
    "renewal": "Renewal",
}

DEFAULT_WEIGHTS: dict[str, int] = {"tickets": 30, "orders": 30, "usage": 25, "renewal": 15}
DEFAULT_THRESHOLDS: dict[str, Any] = {
    # Scores at or above `healthy` are healthy; at or above `at_risk` are at
    # risk; below are critical.
    "bands": {"healthy": 65, "at_risk": 40},
    # Points each open ticket, escalation and SLA breach takes off 100.
    "tickets": {"open": 5, "escalated": 15, "breached": 12},
    # A customer whose last order is this many days old scores 0 on recency;
    # volume and value are compared over two windows of `window_days`.
    "orders": {"recency_days": 180, "window_days": 90},
    # No contact for this many days scores 0 on engagement.
    "usage": {"contact_days": 120},
    # A contract ending further out than this does not weigh on the score.
    "renewal": {"window_days": 120},
}

#: Ticket states that are finished with.
CLOSED_TICKETS = ("RESOLVED", "CLOSED")
#: Orders that are not revenue.
VOID_ORDERS = ("CANCELLED", "REFUNDED")

JOB_CODE = "analytics.customer-health"


# ── the model ────────────────────────────────────────────────────────────


def active_model(session):
    """The active model, created with the defaults on first use."""
    from src.models.records_analytics import HealthModel

    row = session.scalars(
        select(HealthModel).where(HealthModel.active.is_(True)).order_by(HealthModel.updated_at.desc())
    ).first()
    if row is None:
        row = HealthModel(
            name="Default", active=True,
            weights=dict(DEFAULT_WEIGHTS), thresholds=_merged(DEFAULT_THRESHOLDS, {}),
        )
        session.add(row)
        session.flush()
    return row


def model_view(session, *, principal) -> dict[str, Any]:
    principal.require(VIEW)
    row = active_model(session)
    return _model_dict(row, principal)


def _model_dict(row, principal) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "name": row.name,
        "weights": {key: int(row.weights.get(key, 0)) for key in SIGNALS},
        "thresholds": _merged(DEFAULT_THRESHOLDS, row.thresholds or {}),
        "signals": [{"key": key, "label": SIGNAL_LABELS[key]} for key in SIGNALS],
        "bands": [{"key": key, "label": BAND_LABELS[key]} for key in BANDS],
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "can_configure": principal.can(CONFIGURE),
    }


def save_model(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Change weights and thresholds, validated, audited, and applied at once."""
    principal.require(CONFIGURE)
    if not isinstance(payload, dict):
        raise ValidationError("The model must be a JSON object.")
    row = active_model(session)
    before = {"weights": dict(row.weights), "thresholds": _merged(DEFAULT_THRESHOLDS, row.thresholds or {})}

    weights = dict(row.weights)
    raw_weights = payload.get("weights")
    if raw_weights is not None:
        if not isinstance(raw_weights, dict):
            raise ValidationError("weights must be an object.", details={"field": "weights"})
        for key, value in raw_weights.items():
            if key not in SIGNALS:
                raise ValidationError(f"{key} is not a signal.", details={"field": f"weights.{key}", "allowed": list(SIGNALS)})
            weights[key] = _bounded(value, f"weights.{key}", 0, 100)
        if sum(int(weights.get(key, 0)) for key in SIGNALS) <= 0:
            raise ValidationError("At least one signal must carry weight.", details={"field": "weights"})

    thresholds = _merged(DEFAULT_THRESHOLDS, row.thresholds or {})
    raw = payload.get("thresholds")
    if raw is not None:
        if not isinstance(raw, dict):
            raise ValidationError("thresholds must be an object.", details={"field": "thresholds"})
        for group, values in raw.items():
            if group not in DEFAULT_THRESHOLDS or not isinstance(values, dict):
                raise ValidationError(f"{group} is not a threshold group.", details={"field": f"thresholds.{group}"})
            for key, value in values.items():
                if key not in DEFAULT_THRESHOLDS[group]:
                    raise ValidationError(f"{group}.{key} is not a threshold.", details={"field": f"thresholds.{group}.{key}"})
                upper = 100 if group in ("bands", "tickets") else 3650
                thresholds[group][key] = _bounded(value, f"thresholds.{group}.{key}", 1, upper)
        bands = thresholds["bands"]
        if bands["at_risk"] >= bands["healthy"]:
            raise ValidationError(
                "The at-risk cut-off must be below the healthy one.",
                details={"field": "thresholds.bands.at_risk"},
            )

    if isinstance(payload.get("name"), str) and payload["name"].strip():
        row.name = payload["name"].strip()[:120]
    row.weights = weights
    row.thresholds = thresholds
    row.updated_by_id = principal.user_id
    row.updated_at = now()
    session.flush()
    audit.record(
        session, action="CONFIGURATION_CHANGE", resource_type="health_model", resource_id=row.id,
        resource_label=row.name, principal=principal,
        before=before, after={"weights": weights, "thresholds": thresholds},
        message="changed the customer health model",
    )
    result = recompute(session, principal=principal, notify=False)
    return {**_model_dict(row, principal), "recomputed": result}


def _bounded(value: Any, name: str, low: int, high: int) -> int:
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{name} must be a number.", details={"field": name}) from exc
    if number < low or number > high:
        raise ValidationError(f"{name} must be between {low} and {high}.", details={"field": name})
    return number


def _merged(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for group, values in base.items():
        out[group] = dict(values)
        extra = override.get(group) if isinstance(override, dict) else None
        if isinstance(extra, dict):
            out[group].update({k: v for k, v in extra.items() if k in values})
    return out


# ── scoring (pure) ───────────────────────────────────────────────────────


@dataclass
class Inputs:
    """Everything the score is computed from, for one customer."""

    open_tickets: int = 0
    escalated: int = 0
    breached: int = 0
    orders_recent: int = 0
    orders_previous: int = 0
    value_recent: float = 0.0
    value_previous: float = 0.0
    last_order_at: datetime | None = None
    devices: int = 0
    devices_online: int = 0
    device_errors: int = 0
    last_contact_at: datetime | None = None
    contract: dict[str, Any] | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def band_for(score: int, thresholds: dict[str, Any]) -> str:
    bands = thresholds.get("bands", DEFAULT_THRESHOLDS["bands"])
    if score >= int(bands["healthy"]):
        return "HEALTHY"
    if score >= int(bands["at_risk"]):
        return "AT_RISK"
    return "CRITICAL"


def _clamp(value: float, low: float = 0, high: float = 100) -> float:
    return max(low, min(high, value))


def _days_since(moment: datetime | None, today: datetime) -> int | None:
    if moment is None:
        return None
    return max(0, (today - moment).days)


def _trend(recent: float, previous: float) -> float:
    """50 is flat; 100 is doubled or new; 0 is gone."""
    if previous <= 0:
        # Nothing in either window is quiet rather than collapsing.
        return 100.0 if recent > 0 else 30.0
    return _clamp(50 + 50 * (recent / previous - 1))


def score(inputs: Inputs, weights: dict[str, Any], thresholds: dict[str, Any], *, today: datetime) -> dict[str, Any]:
    """The score, its band and the breakdown, from one customer's inputs."""
    t = _merged(DEFAULT_THRESHOLDS, thresholds)
    parts: dict[str, dict[str, Any]] = {}

    # Tickets: start from 100, every open problem takes points off.
    tk = t["tickets"]
    penalties = [
        (inputs.open_tickets, int(tk["open"]), "open ticket", "open tickets"),
        (inputs.escalated, int(tk["escalated"]), "escalated ticket", "escalated tickets"),
        (inputs.breached, int(tk["breached"]), "SLA breach in 90 days", "SLA breaches in 90 days"),
    ]
    facts = []
    lost = 0
    for count, points, one, many in penalties:
        if count:
            facts.append({"text": f"{count} {one if count == 1 else many}", "impact": -count * points})
            lost += count * points
    if not facts:
        facts.append({"text": "No open support tickets", "impact": 0})
    parts["tickets"] = {
        "score": round(_clamp(100 - lost)),
        "facts": facts,
        "inputs": {"open": inputs.open_tickets, "escalated": inputs.escalated, "breached": inputs.breached},
    }

    # Orders: recency, then volume and value against the previous window.
    od = t["orders"]
    days = _days_since(inputs.last_order_at, today)
    horizon = max(1, int(od["recency_days"]))
    recency = 0.0 if days is None else _clamp(100 * (1 - days / horizon))
    volume = _trend(inputs.orders_recent, inputs.orders_previous)
    value = _trend(inputs.value_recent, inputs.value_previous)
    order_score = recency * 0.4 + volume * 0.3 + value * 0.3
    window = int(od["window_days"])
    order_facts = [
        {"text": "No orders yet" if days is None else f"Last order {days} day{'s' if days != 1 else ''} ago",
         "impact": round(recency * 0.4 - 40)},
        {"text": f"{inputs.orders_recent} order{'s' if inputs.orders_recent != 1 else ''} in {window} days "
                 f"(previously {inputs.orders_previous})", "impact": round(volume * 0.3 - 15)},
        {"text": f"€{inputs.value_recent:,.0f} ordered in {window} days (previously €{inputs.value_previous:,.0f})",
         "impact": round(value * 0.3 - 15)},
    ]
    parts["orders"] = {
        "score": round(order_score),
        "facts": order_facts,
        "inputs": {
            "recent": inputs.orders_recent, "previous": inputs.orders_previous,
            "value_recent": round(inputs.value_recent, 2), "value_previous": round(inputs.value_previous, 2),
            "days_since_last": days,
        },
    }

    # Usage: devices online, and how recently anybody spoke to them.
    us = t["usage"]
    contact_days = _days_since(inputs.last_contact_at, today)
    contact_horizon = max(1, int(us["contact_days"]))
    engagement = 0.0 if contact_days is None else _clamp(100 * (1 - contact_days / contact_horizon))
    usage_facts = []
    if inputs.devices:
        online = inputs.devices_online / inputs.devices
        usage_score = online * 100 * 0.6 + engagement * 0.4
        usage_facts.append({"text": f"{inputs.devices_online} of {inputs.devices} devices online",
                            "impact": round(online * 60 - 60)})
        if inputs.device_errors:
            usage_facts.append({"text": f"{inputs.device_errors} device errors reported", "impact": 0})
    else:
        usage_score = engagement
        usage_facts.append({"text": "No devices under management", "impact": 0})
    usage_facts.append({
        "text": "Never contacted" if contact_days is None
        else f"Last contact {contact_days} day{'s' if contact_days != 1 else ''} ago",
        "impact": round(engagement * (0.4 if inputs.devices else 1) - (40 if inputs.devices else 100)),
    })
    parts["usage"] = {
        "score": round(_clamp(usage_score)),
        "facts": usage_facts,
        "inputs": {"devices": inputs.devices, "online": inputs.devices_online,
                   "errors": inputs.device_errors, "days_since_contact": contact_days},
    }

    # Renewal: how close the next end date is, and how likely it renews.
    rn = t["renewal"]
    contract = inputs.contract
    if contract is None:
        renewal_score = 70.0
        renewal_facts = [{"text": "No contract on file", "impact": 0}]
    else:
        stage = contract.get("stage")
        to_end = int(contract.get("days_to_end") or 0)
        label = contract.get("reference") or "Contract"
        if stage in ("COMMITTED", "RENEWED"):
            renewal_score = 100.0
            renewal_facts = [{"text": f"{label} {'renewed' if stage == 'RENEWED' else 'committed to renew'}",
                              "impact": 0}]
        elif stage == "CHURNED":
            renewal_score = 0.0
            renewal_facts = [{"text": f"{label} churned", "impact": -100}]
        else:
            span = max(1, int(rn["window_days"]))
            proximity = 100.0 if to_end > span else 40 + 60 * max(0, to_end) / span
            probability = int(contract.get("probability") or 0)
            renewal_score = proximity * 0.6 + probability * 0.4
            when = f"ends in {to_end} day{'s' if to_end != 1 else ''}" if to_end >= 0 else f"ended {-to_end} days ago"
            renewal_facts = [
                {"text": f"{label} {when}", "impact": round(proximity * 0.6 - 60)},
                {"text": f"{probability}% likely to renew ({str(stage).replace('_', ' ').lower()})",
                 "impact": round(probability * 0.4 - 40)},
            ]
    parts["renewal"] = {
        "score": round(_clamp(renewal_score)),
        "facts": renewal_facts,
        "inputs": dict(contract or {}),
    }

    total_weight = sum(max(0, int(weights.get(key, 0))) for key in SIGNALS) or 1
    overall = 0.0
    for key in SIGNALS:
        weight = max(0, int(weights.get(key, 0)))
        contribution = parts[key]["score"] * weight / total_weight
        parts[key].update({
            "key": key,
            "label": SIGNAL_LABELS[key],
            "weight": weight,
            "share": round(weight * 100 / total_weight, 1),
            "contribution": round(contribution, 1),
        })
        overall += contribution
    final = int(round(_clamp(overall)))
    return {"score": final, "band": band_for(final, t), "components": parts}


# ── gathering inputs ─────────────────────────────────────────────────────


def gather(session, *, today: datetime, thresholds: dict[str, Any], customer_ids: list[UUID] | None = None) -> dict[UUID, Inputs]:
    """Every live customer's inputs, in one grouped query per signal."""
    from src.models.business import Customer, Device, Order, Project, Ticket
    from src.models.records_analytics import Contract

    t = _merged(DEFAULT_THRESHOLDS, thresholds)
    window = timedelta(days=int(t["orders"]["window_days"]))

    customers = select(Customer.id, Customer.last_contact_at).where(Customer.deleted_at.is_(None))
    if customer_ids is not None:
        customers = customers.where(Customer.id.in_(customer_ids))
    inputs: dict[UUID, Inputs] = {
        row.id: Inputs(last_contact_at=row.last_contact_at) for row in session.execute(customers)
    }
    if not inputs:
        return inputs
    ids = list(inputs)

    is_open = Ticket.status.notin_(CLOSED_TICKETS)
    tickets = session.execute(
        select(
            Ticket.customer_id,
            func.count().filter(is_open),
            func.count().filter(and_(is_open, or_(
                Ticket.status == "ESCALATED", Ticket.priority == "CRITICAL", Ticket.severity == "CRITICAL",
            ))),
            func.count().filter(and_(Ticket.sla_breached.is_(True), Ticket.created_at >= today - timedelta(days=90))),
        )
        .where(Ticket.deleted_at.is_(None), Ticket.customer_id.in_(ids))
        .group_by(Ticket.customer_id)
    )
    for customer_id, open_count, escalated, breached in tickets:
        row = inputs[customer_id]
        row.open_tickets, row.escalated, row.breached = int(open_count), int(escalated), int(breached)

    recent = Order.placed_at >= today - window
    previous = and_(Order.placed_at < today - window, Order.placed_at >= today - 2 * window)
    orders = session.execute(
        select(
            Order.customer_id,
            func.count().filter(recent),
            func.count().filter(previous),
            func.coalesce(func.sum(case((recent, Order.total), else_=0)), 0),
            func.coalesce(func.sum(case((previous, Order.total), else_=0)), 0),
            func.max(Order.placed_at),
        )
        .where(Order.deleted_at.is_(None), Order.status.notin_(VOID_ORDERS), Order.customer_id.in_(ids))
        .group_by(Order.customer_id)
    )
    for customer_id, n_recent, n_previous, v_recent, v_previous, last in orders:
        row = inputs[customer_id]
        row.orders_recent, row.orders_previous = int(n_recent), int(n_previous)
        row.value_recent, row.value_previous = float(v_recent or 0), float(v_previous or 0)
        row.last_order_at = last

    devices = session.execute(
        select(
            Project.customer_id,
            func.count(Device.id),
            func.count(Device.id).filter(Device.status == "ONLINE"),
            func.coalesce(func.sum(Device.error_count), 0),
        )
        .join(Project, Project.id == Device.project_id)
        .where(
            Device.deleted_at.is_(None), Device.status != "DECOMMISSIONED",
            Project.customer_id.in_(ids),
        )
        .group_by(Project.customer_id)
    )
    for customer_id, total, online, errors in devices:
        row = inputs[customer_id]
        row.devices, row.devices_online, row.device_errors = int(total), int(online), int(errors)

    # The contract that matters is the next one to end that is still being
    # worked; failing that, the most recently closed.
    contracts = session.scalars(
        select(Contract).where(Contract.deleted_at.is_(None), Contract.customer_id.in_(ids))
        .order_by(Contract.end_date)
    ).all()
    chosen: dict[UUID, Any] = {}
    for contract in contracts:
        current = chosen.get(contract.customer_id)
        open_now = contract.stage not in ("RENEWED", "CHURNED")
        if current is None:
            chosen[contract.customer_id] = contract
            continue
        current_open = current.stage not in ("RENEWED", "CHURNED")
        if open_now and not current_open:
            chosen[contract.customer_id] = contract
        elif open_now == current_open and not open_now and contract.end_date > current.end_date:
            chosen[contract.customer_id] = contract
    for customer_id, contract in chosen.items():
        inputs[customer_id].contract = {
            "id": str(contract.id),
            "reference": contract.reference,
            "stage": contract.stage,
            "probability": int(contract.probability or 0),
            "end_date": contract.end_date.isoformat(),
            "days_to_end": (contract.end_date - today.date()).days,
            "value": float(contract.value or 0),
        }
    return inputs


# ── recompute ────────────────────────────────────────────────────────────


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
    from src.services import notifications

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


# ── reads ────────────────────────────────────────────────────────────────


def customer(session, customer_id: Any, *, principal, days: int = 90) -> dict[str, Any]:
    """One customer's score, band, breakdown and trend."""
    from src.models.business import Customer
    from src.models.records_analytics import CustomerHealth, CustomerHealthSnapshot

    principal.require(VIEW)
    identifier = parse_uuid(customer_id, field="customer_id")
    row = session.scalars(select(Customer).where(Customer.id == identifier, Customer.deleted_at.is_(None))).first()
    if row is None:
        raise NotFoundError("That customer does not exist.", details={"id": str(customer_id)})
    health = session.scalars(select(CustomerHealth).where(CustomerHealth.customer_id == identifier)).first()
    if health is None:
        recompute(session, notify=False, customer_ids=[identifier])
        health = session.scalars(select(CustomerHealth).where(CustomerHealth.customer_id == identifier)).first()
    span = max(7, min(365, int(days)))
    trend = session.execute(
        select(CustomerHealthSnapshot.day, CustomerHealthSnapshot.score, CustomerHealthSnapshot.band,
               CustomerHealthSnapshot.components)
        .where(CustomerHealthSnapshot.customer_id == identifier,
               CustomerHealthSnapshot.day >= now().date() - timedelta(days=span))
        .order_by(CustomerHealthSnapshot.day)
    ).all()
    model = active_model(session)
    return {
        "customer": {"id": str(row.id), "name": row.name, "code": row.code},
        **_health_dict(health),
        "trend": [
            {"day": day.isoformat(), "score": value, "band": band, "components": components or {}}
            for day, value, band, components in trend
        ],
        "thresholds": _merged(DEFAULT_THRESHOLDS, model.thresholds or {})["bands"],
    }


def _health_dict(health) -> dict[str, Any]:
    components = health.components or {}
    return {
        "score": health.score,
        "band": health.band,
        "band_label": BAND_LABELS.get(health.band, health.band),
        "previous_band": health.previous_band,
        "band_changed_at": health.band_changed_at.isoformat() if health.band_changed_at else None,
        "delta_7d": health.delta_7d,
        "delta_30d": health.delta_30d,
        "computed_at": health.computed_at.isoformat() if health.computed_at else None,
        "components": [components[key] for key in SIGNALS if key in components],
    }


def portfolio(session, args, *, principal) -> dict[str, Any]:
    """The book by health: distribution, histogram, movers, and a filtered list."""
    from src.models.business import Customer
    from src.models.records_analytics import CustomerHealth

    principal.require(VIEW)
    base = (
        select(CustomerHealth, Customer)
        .join(Customer, Customer.id == CustomerHealth.customer_id)
        .where(Customer.deleted_at.is_(None))
    )
    rows = session.execute(base).all()
    distribution = {band: 0 for band in BANDS}
    histogram = [0] * 10
    total = 0
    for health, _customer in rows:
        distribution[health.band] = distribution.get(health.band, 0) + 1
        histogram[min(9, max(0, health.score // 10))] += 1
        total += health.score

    def entry(health, cust) -> dict[str, Any]:
        return {
            "id": str(cust.id), "name": cust.name, "code": cust.code, "segment": cust.segment,
            "score": health.score, "band": health.band, "previous_band": health.previous_band,
            "delta_7d": health.delta_7d, "delta_30d": health.delta_30d,
            "lifetime_value": float(cust.lifetime_value or 0),
            "band_changed_at": health.band_changed_at.isoformat() if health.band_changed_at else None,
        }

    period = "delta_7d" if str(args.get("period") or "30d") == "7d" else "delta_30d"
    moved = [(getattr(h, period), h, c) for h, c in rows if getattr(h, period)]
    up = sorted((m for m in moved if m[0] > 0), key=lambda m: -m[0])[:5]
    down = sorted((m for m in moved if m[0] < 0), key=lambda m: m[0])[:5]

    band = str(args.get("band") or "").upper()
    query = str(args.get("q") or "").strip().lower()
    listed = [
        (h, c) for h, c in rows
        if (not band or h.band == band) and (not query or query in c.name.lower() or query in c.code.lower())
    ]
    sort = str(args.get("sort") or "score")
    reverse = str(args.get("order") or "asc") == "desc"
    keys = {
        "score": lambda pair: pair[0].score,
        "delta": lambda pair: getattr(pair[0], period) or 0,
        "name": lambda pair: pair[1].name.lower(),
        "value": lambda pair: float(pair[1].lifetime_value or 0),
    }
    listed.sort(key=keys.get(sort, keys["score"]), reverse=reverse)
    try:
        page = max(1, int(args.get("page") or 1))
        size = max(1, min(100, int(args.get("page_size") or 25)))
    except (TypeError, ValueError) as exc:
        raise ValidationError("page and page_size must be integers.") from exc

    recent_drops = sorted(
        (pair for pair in rows if pair[0].band_changed_at and pair[0].previous_band
         and BANDS.index(pair[0].band) > BANDS.index(pair[0].previous_band)),
        key=lambda pair: pair[0].band_changed_at, reverse=True,
    )[:6]
    computed = max((h.computed_at for h, _ in rows if h.computed_at), default=None)
    model = active_model(session)
    return {
        "total": len(rows),
        "average": round(total / len(rows)) if rows else None,
        "distribution": [{"band": key, "label": BAND_LABELS[key], "count": distribution[key]} for key in BANDS],
        "histogram": [{"from": i * 10, "to": i * 10 + 9 if i < 9 else 100, "count": n} for i, n in enumerate(histogram)],
        "movers": {
            "period": "7d" if period == "delta_7d" else "30d",
            "up": [entry(h, c) for _, h, c in up],
            "down": [entry(h, c) for _, h, c in down],
        },
        "drops": [entry(h, c) for h, c in recent_drops],
        "items": [entry(h, c) for h, c in listed[(page - 1) * size: page * size]],
        "matching": len(listed),
        "page": page,
        "page_size": size,
        "computed_at": computed.isoformat() if computed else None,
        "thresholds": _merged(DEFAULT_THRESHOLDS, model.thresholds or {})["bands"],
        "can_configure": principal.can(CONFIGURE),
    }
