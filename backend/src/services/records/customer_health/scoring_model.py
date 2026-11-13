"""Health-score bands, signals, weights, and the editable scoring model."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.errors import ValidationError

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
