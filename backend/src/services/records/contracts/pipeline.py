"""The contract list, its summary, and the board."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy import or_

from src.core.clock import now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.services.records.contracts.fields import (
    DEFAULT_PROBABILITY,
    MANAGE,
    OPEN_STAGES,
    STAGE_LABELS,
    STAGES,
    VIEW,
    _base,
)
from src.services.records.contracts.lifecycle import _catch_up
from src.services.records.contracts.serializers import _bands, _card


def _filtered(statement, args):
    from src.models.business import Customer
    from src.models.records_analytics import Contract

    stages = [s.strip().upper() for s in str(args.get("stage") or "").split(",") if s.strip()]
    if stages:
        bad = [s for s in stages if s not in STAGES]
        if bad:
            raise ValidationError("Unknown stage.", details={"stage": bad, "allowed": list(STAGES)})
        statement = statement.where(Contract.stage.in_(stages))
    if args.get("owner_id"):
        statement = statement.where(Contract.owner_id == parse_uuid(args.get("owner_id"), field="owner_id"))
    if args.get("customer_id"):
        statement = statement.where(Contract.customer_id == parse_uuid(args.get("customer_id"), field="customer_id"))
    term = str(args.get("q") or "").strip()
    if term:
        statement = statement.join(Customer, Customer.id == Contract.customer_id).where(or_(
            Contract.title.ilike(f"%{term}%"), Contract.reference.ilike(f"%{term}%"), Customer.name.ilike(f"%{term}%"),
        ))
    for key, op in (("ending_from", "ge"), ("ending_to", "le")):
        if args.get(key):
            try:
                day = date.fromisoformat(str(args.get(key))[:10])
            except ValueError as exc:
                raise ValidationError(f"{key} must be a date.", details={"field": key}) from exc
            statement = statement.where(Contract.end_date >= day if op == "ge" else Contract.end_date <= day)
    return statement


def listing(session, args, *, principal) -> dict[str, Any]:
    from src.models.records_analytics import Contract

    principal.require(VIEW)
    statement = _filtered(_base(), args)
    rows = session.scalars(statement.order_by(Contract.end_date, Contract.reference)).unique().all()
    today = now().date()
    bands = _bands(session, {r.customer_id for r in rows})
    cards = [_card(r, bands, today) for r in rows]
    if str(args.get("at_risk") or "").lower() in ("1", "true", "yes"):
        cards = [c for c in cards if c["at_risk"]]
    sort = str(args.get("sort") or "end_date")
    if sort in ("value", "probability", "weighted"):
        cards.sort(key=lambda c: c[sort], reverse=str(args.get("order") or "desc") == "desc")
    try:
        page = max(1, int(args.get("page") or 1))
        size = max(1, min(200, int(args.get("page_size") or 50)))
    except (TypeError, ValueError) as exc:
        raise ValidationError("page and page_size must be integers.") from exc
    return {
        "items": cards[(page - 1) * size: page * size],
        "total": len(cards),
        "page": page,
        "page_size": size,
        "summary": _summary(cards),
        "stages": [{"key": s, "label": STAGE_LABELS[s]} for s in STAGES],
        "can_manage": principal.can(MANAGE),
    }


def _summary(cards: list[dict[str, Any]]) -> dict[str, Any]:
    open_cards = [c for c in cards if c["stage"] in OPEN_STAGES]
    return {
        "open": len(open_cards),
        "pipeline": round(sum(c["value"] for c in open_cards), 2),
        "weighted": round(sum(c["weighted"] for c in open_cards), 2),
        "at_risk": sum(1 for c in open_cards if c["at_risk"]),
        "at_risk_value": round(sum(c["value"] for c in open_cards if c["at_risk"]), 2),
        "due_90": sum(1 for c in open_cards if c["days_to_end"] is not None and c["days_to_end"] <= 90),
    }


def board(session, args, *, principal) -> dict[str, Any]:
    """The pipeline: one column per stage, cards in rank order, totals per column."""
    from src.models.records_analytics import Contract

    principal.require(VIEW)
    _catch_up(session)
    statement = _filtered(_base(), args)
    # A closed column shows what closed recently, not every renewal ever won.
    horizon = now() - timedelta(days=int(args.get("closed_days") or 120))
    statement = statement.where(or_(Contract.stage.in_(OPEN_STAGES), Contract.closed_at >= horizon,
                                    Contract.closed_at.is_(None)))
    rows = session.scalars(statement.order_by(Contract.rank, Contract.end_date)).unique().all()
    today = now().date()
    bands = _bands(session, {r.customer_id for r in rows})
    columns = []
    for stage in STAGES:
        cards = [_card(r, bands, today) for r in rows if r.stage == stage]
        columns.append({
            "stage": stage, "label": STAGE_LABELS[stage], "probability": DEFAULT_PROBABILITY[stage],
            "count": len(cards), "value": round(sum(c["value"] for c in cards), 2),
            "weighted": round(sum(c["weighted"] for c in cards), 2),
            "at_risk": sum(1 for c in cards if c["at_risk"]), "cards": cards,
        })
    every = [c for col in columns for c in col["cards"]]
    return {"columns": columns, "summary": _summary(every), "can_manage": principal.can(MANAGE)}


def _quarter(day: date) -> tuple[int, int]:
    return day.year, (day.month - 1) // 3 + 1
