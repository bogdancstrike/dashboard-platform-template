"""One customer's score from its inputs."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from src.services.records.customer_health.scoring_model import (
    DEFAULT_THRESHOLDS,
    SIGNAL_LABELS,
    SIGNALS,
    _merged,
)
from src.services.records.customer_health.signals import (
    Inputs,
    _clamp,
    _days_since,
    _trend,
    band_for,
)


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
