"""One customer's health, and the portfolio."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import found_or_404
from src.services.records.customer_health.recompute_job import recompute
from src.services.records.customer_health.scoring_model import (
    BAND_LABELS,
    BANDS,
    CONFIGURE,
    DEFAULT_THRESHOLDS,
    SIGNALS,
    VIEW,
    _merged,
    active_model,
)


def customer(session, customer_id: Any, *, principal, days: int = 90) -> dict[str, Any]:
    """One customer's score, band, breakdown and trend."""
    from src.models.business import Customer
    from src.models.records_analytics import CustomerHealth, CustomerHealthSnapshot

    principal.require(VIEW)
    identifier = parse_uuid(customer_id, field="customer_id")
    row = found_or_404(
        session.scalars(select(Customer).where(Customer.id == identifier, Customer.deleted_at.is_(None))).first(),
        "That customer does not exist.",
        details={"id": str(customer_id)},
    )
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
