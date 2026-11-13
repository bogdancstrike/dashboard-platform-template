"""The renewal forecast and calendar, and loading one contract."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, or_

from src.core.clock import now
from src.core.errors import ValidationError
from src.services.records.contracts.fields import (
    AT_RISK_BANDS,
    OPEN_STAGES,
    VIEW,
    _base,
    _load,
)
from src.services.records.contracts.pipeline import _filtered, _quarter
from src.services.records.contracts.serializers import _bands, _card, _detail


def forecast(session, args, *, principal) -> dict[str, Any]:
    """Renewal ARR by the quarter it comes up in: pipeline, weighted, committed, won, lost."""
    from src.models.records_analytics import Contract

    principal.require(VIEW)
    try:
        quarters = max(1, min(8, int(args.get("quarters") or 4)))
    except (TypeError, ValueError) as exc:
        raise ValidationError("quarters must be a whole number.") from exc
    today = now().date()
    first = date(today.year, ((today.month - 1) // 3) * 3 + 1, 1)
    keys: list[tuple[int, int]] = []
    year, q = _quarter(first)
    q -= 1  # one quarter back, so the closed ones are visible beside the open
    if q == 0:
        year, q = year - 1, 4
    for _ in range(quarters + 1):
        keys.append((year, q))
        q += 1
        if q == 5:
            year, q = year + 1, 1
    start = date(keys[0][0], (keys[0][1] - 1) * 3 + 1, 1)
    last_year, last_q = keys[-1]
    end = date(last_year + (1 if last_q == 4 else 0), 1 if last_q == 4 else last_q * 3 + 1, 1)
    rows = session.scalars(
        _base().where(Contract.end_date >= start, Contract.end_date < end)
    ).all()
    buckets = {k: {"pipeline": 0.0, "weighted": 0.0, "committed": 0.0, "renewed": 0.0, "churned": 0.0,
                   "count": 0, "at_risk": 0.0} for k in keys}
    bands = _bands(session, {r.customer_id for r in rows})
    for row in rows:
        bucket = buckets.get(_quarter(row.end_date))
        if bucket is None:  # pragma: no cover - outside by construction
            continue
        value = float(row.value or 0)
        bucket["count"] += 1
        if row.stage in OPEN_STAGES:
            bucket["pipeline"] += value
            bucket["weighted"] += value * (row.probability or 0) / 100
            if row.stage == "COMMITTED":
                bucket["committed"] += value
            if bands.get(row.customer_id, (None,))[0] in AT_RISK_BANDS:
                bucket["at_risk"] += value
        elif row.stage == "RENEWED":
            bucket["renewed"] += value
            bucket["weighted"] += value
        else:
            bucket["churned"] += value
    current = _quarter(today)
    out = []
    for key in keys:
        values = buckets[key]
        out.append({
            "key": f"{key[0]}-Q{key[1]}", "label": f"Q{key[1]} {key[0]}",
            "current": key == current, "past": key < current,
            **{k: (round(v, 2) if isinstance(v, float) else v) for k, v in values.items()},
        })
    return {
        "quarters": out,
        "totals": {k: round(sum(q[k] for q in out), 2) for k in ("pipeline", "weighted", "committed", "renewed", "churned", "at_risk")},
    }


def calendar(session, args, *, principal) -> dict[str, Any]:
    """End dates and notice deadlines in a month (or a range)."""
    from src.models.records_analytics import Contract

    principal.require(VIEW)
    month = str(args.get("month") or "")
    try:
        if month:
            first = date.fromisoformat(f"{month[:7]}-01")
        else:
            today = now().date()
            first = date(today.year, today.month, 1)
    except ValueError as exc:
        raise ValidationError("month must be YYYY-MM.", details={"field": "month"}) from exc
    following = date(first.year + (1 if first.month == 12 else 0), 1 if first.month == 12 else first.month + 1, 1)
    rows = session.scalars(
        _filtered(_base(), args).where(
            or_(
                Contract.end_date.between(first, following - timedelta(days=1)),
                (Contract.end_date - func.make_interval(0, 0, 0, Contract.notice_days)).between(first, following),
            )
        ).order_by(Contract.end_date)
    ).unique().all()
    today = now().date()
    bands = _bands(session, {r.customer_id for r in rows})
    events = []
    for row in rows:
        card = _card(row, bands, today)
        if first <= row.end_date < following:
            events.append({"day": row.end_date.isoformat(), "kind": "END", "contract": card})
        notice = row.end_date - timedelta(days=int(row.notice_days or 0))
        if row.notice_days and first <= notice < following and row.stage in OPEN_STAGES:
            events.append({"day": notice.isoformat(), "kind": "NOTICE", "contract": card})
    events.sort(key=lambda e: (e["day"], e["kind"]))
    return {"month": first.isoformat()[:7], "from": first.isoformat(),
            "to": (following - timedelta(days=1)).isoformat(), "events": events}


def get(session, contract_id: Any, *, principal) -> dict[str, Any]:
    principal.require(VIEW)
    return _detail(session, _load(session, contract_id), principal)


def load(session, contract_id: Any):
    """Exported for version history: the live row, or a 404."""
    return _load(session, contract_id)
