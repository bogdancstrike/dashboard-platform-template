"""Small scoring helpers: bands, clamps, recency and trend."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from src.services.records.customer_health.scoring_model import DEFAULT_THRESHOLDS


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
