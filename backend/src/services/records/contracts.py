"""Contracts and the renewals pipeline (§13).

Built on the customer renewals the design already mentions: a contract is a
customer agreement with a value (ARR), a term and an end date, and as the end
date approaches it is *worked* — through a pipeline of stages:

    UPCOMING → NEGOTIATION → COMMITTED → RENEWED | CHURNED

Four decisions:

* **History is the audit trail.** Every create, edit and stage move is an
  audit row on `resource_type = "contract"` with the fields before and after,
  exactly the shape record writes leave — which is what makes a contract's
  version history (§17) the same feature as a ticket's, restore included.
* **Stage carries a default probability.** Moving a card sets the stage's
  probability unless the reader has set one by hand on the way; the forecast
  weights each open contract by it.
* **At risk is the health score's word, not a second opinion.** A contract is
  flagged when its customer's health band is at risk or critical (§12), and a
  change to a contract recomputes that customer's score — a churned renewal
  is the strongest health signal there is.
* **Files live in the platform's file store**, in a folder per contract
  created on first upload, so a contract's documents are also files anybody
  with access can find in /files.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from src.core import audit
from src.core.clock import now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.naming import identifier, sequence_of
from src.core.pagination import parse_uuid

VIEW = "records.view"
MANAGE = "contracts.manage"

STAGES = ("UPCOMING", "NEGOTIATION", "COMMITTED", "RENEWED", "CHURNED")
STAGE_LABELS = {
    "UPCOMING": "Upcoming", "NEGOTIATION": "In negotiation", "COMMITTED": "Committed",
    "RENEWED": "Renewed", "CHURNED": "Churned",
}
OPEN_STAGES = ("UPCOMING", "NEGOTIATION", "COMMITTED")
CLOSED_STAGES = ("RENEWED", "CHURNED")
DEFAULT_PROBABILITY = {"UPCOMING": 50, "NEGOTIATION": 65, "COMMITTED": 90, "RENEWED": 100, "CHURNED": 0}
BILLING = ("MONTHLY", "QUARTERLY", "ANNUAL")
CURRENCIES = ("EUR", "USD", "GBP")
AT_RISK_BANDS = ("AT_RISK", "CRITICAL")

#: The fields a form may write, by kind. Also the audit state, so a version is
#: a full set of these.
FIELDS: dict[str, str] = {
    "title": "text", "customer_id": "customer", "owner_id": "user", "value": "money",
    "currency": "currency", "start_date": "date", "end_date": "date", "term_months": "int",
    "billing": "billing", "auto_renew": "bool", "notice_days": "int", "stage": "stage",
    "probability": "percent", "terms": "longtext", "notes": "longtext", "churn_reason": "text",
}
LABELS = {
    "title": "Title", "customer_id": "Customer", "owner_id": "Owner", "value": "Value (ARR)",
    "currency": "Currency", "start_date": "Start date", "end_date": "End date",
    "term_months": "Term (months)", "billing": "Billing", "auto_renew": "Auto-renew",
    "notice_days": "Notice (days)", "stage": "Stage", "probability": "Probability",
    "terms": "Terms", "notes": "Notes", "churn_reason": "Churn reason",
}
REQUIRED = ("title", "customer_id", "value", "start_date", "end_date")
_ATTEMPTS = 5


# ── coercion ─────────────────────────────────────────────────────────────


def coerce(session, payload: dict[str, Any], *, creating: bool) -> dict[str, Any]:
    """Every field the payload names, converted and checked; unknown keys refused."""
    if not isinstance(payload, dict):
        raise ValidationError("The contract must be a JSON object.")
    unknown = sorted(set(payload) - set(FIELDS) - {"expected_updated_at"})
    if unknown:
        raise ValidationError("Those fields cannot be written.",
                              details={"fields": unknown, "editable": sorted(FIELDS)})
    values: dict[str, Any] = {}
    for name, kind in FIELDS.items():
        if name not in payload:
            if creating and name in REQUIRED:
                raise ValidationError(f"{LABELS[name]} is required.", details={"field": name})
            continue
        values[name] = _value(session, name, kind, payload[name])
        if values[name] is None and name in REQUIRED:
            raise ValidationError(f"{LABELS[name]} cannot be empty.", details={"field": name})
    return values


def _value(session, name: str, kind: str, raw: Any) -> Any:
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return False if kind == "bool" else None
    if kind in ("text", "longtext"):
        text = str(raw).strip()
        limit = 200 if kind == "text" else 20_000
        if len(text) > limit:
            raise ValidationError(f"{LABELS[name]} is longer than {limit} characters.", details={"field": name})
        return text
    if kind in ("int", "percent"):
        try:
            number = int(Decimal(str(raw).strip()))
        except (InvalidOperation, ValueError) as exc:
            raise ValidationError(f"{LABELS[name]} must be a whole number.", details={"field": name}) from exc
        high = 100 if kind == "percent" else (120 if name == "term_months" else 365)
        if number < 0 or number > high or (name == "term_months" and number < 1):
            raise ValidationError(f"{LABELS[name]} must be between {1 if name == 'term_months' else 0} and {high}.",
                                  details={"field": name})
        return number
    if kind == "money":
        try:
            number = Decimal(str(raw).replace(",", "").replace("€", "").strip())
        except (InvalidOperation, ValueError) as exc:
            raise ValidationError(f"{LABELS[name]} must be a number.", details={"field": name}) from exc
        if number < 0 or number > Decimal("1000000000"):
            raise ValidationError(f"{LABELS[name]} must be between 0 and 1,000,000,000.", details={"field": name})
        return number.quantize(Decimal("0.01"))
    if kind == "date":
        try:
            return date.fromisoformat(str(raw).strip()[:10])
        except ValueError as exc:
            raise ValidationError(f"{LABELS[name]} must be a date (YYYY-MM-DD).", details={"field": name}) from exc
    if kind == "bool":
        if isinstance(raw, bool):
            return raw
        text = str(raw).strip().lower()
        if text in ("true", "1", "yes"):
            return True
        if text in ("false", "0", "no"):
            return False
        raise ValidationError(f"{LABELS[name]} must be true or false.", details={"field": name})
    choices = {"currency": CURRENCIES, "billing": BILLING, "stage": STAGES}.get(kind)
    if choices is not None:
        text = str(raw).strip().upper()
        if text not in choices:
            raise ValidationError(f"{text} is not a {LABELS[name].lower()} a contract can have.",
                                  details={"field": name, "allowed": list(choices)})
        return text
    # customer / user references
    value = parse_uuid(raw, field=name)
    if kind == "customer":
        from src.models.business import Customer

        model = Customer
    else:
        from src.models.identity import User

        model = User
    exists = session.scalar(select(func.count()).select_from(model).where(model.id == value, model.deleted_at.is_(None)))
    if not exists:
        raise NotFoundError(f"No {LABELS[name].lower()} with that id.", details={"field": name, "value": str(value)})
    return value


def _check_dates(row) -> None:
    if row.start_date and row.end_date and row.end_date <= row.start_date:
        raise ValidationError("The end date must be after the start date.", details={"field": "end_date"})


# ── serialisation ────────────────────────────────────────────────────────


def state(row) -> dict[str, Any]:
    """The audit diff's view of a contract — every writable field, as JSON."""
    out: dict[str, Any] = {}
    for name in FIELDS:
        value = getattr(row, name, None)
        if isinstance(value, (date, datetime)):
            value = value.isoformat()
        elif isinstance(value, UUID):
            value = str(value)
        elif isinstance(value, Decimal):
            value = float(value)
        out[name] = value
    return out


def _bands(session, customer_ids: set[UUID]) -> dict[UUID, tuple[str, int]]:
    from src.models.records_analytics import CustomerHealth

    if not customer_ids:
        return {}
    return {
        row.customer_id: (row.band, row.score)
        for row in session.scalars(select(CustomerHealth).where(CustomerHealth.customer_id.in_(customer_ids)))
    }


def _card(row, bands: dict[UUID, tuple[str, int]], today: date) -> dict[str, Any]:
    band, score_value = bands.get(row.customer_id, (None, None))
    open_now = row.stage in OPEN_STAGES
    return {
        "id": str(row.id),
        "reference": row.reference,
        "title": row.title,
        "customer": {"id": str(row.customer_id), "name": row.customer.name if row.customer else None,
                     "code": row.customer.code if row.customer else None},
        "owner": {"id": str(row.owner_id) if row.owner_id else None,
                  "name": row.owner.full_name if row.owner else None},
        "value": float(row.value or 0),
        "weighted": round(float(row.value or 0) * (row.probability or 0) / 100, 2),
        "currency": row.currency,
        "start_date": row.start_date.isoformat() if row.start_date else None,
        "end_date": row.end_date.isoformat() if row.end_date else None,
        "days_to_end": (row.end_date - today).days if row.end_date else None,
        "stage": row.stage,
        "stage_label": STAGE_LABELS.get(row.stage, row.stage),
        "probability": int(row.probability or 0),
        "rank": row.rank,
        "auto_renew": bool(row.auto_renew),
        "health_band": band,
        "health_score": score_value,
        "at_risk": bool(open_now and band in AT_RISK_BANDS),
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _detail(session, row, principal) -> dict[str, Any]:
    today = now().date()
    card = _card(row, _bands(session, {row.customer_id}), today)
    notice_by = row.end_date - timedelta(days=int(row.notice_days or 0)) if row.end_date else None
    return {
        **card,
        "term_months": row.term_months,
        "billing": row.billing,
        "notice_days": row.notice_days,
        "notice_by": notice_by.isoformat() if notice_by else None,
        "terms": row.terms,
        "notes": row.notes,
        "churn_reason": row.churn_reason,
        "stage_changed_at": row.stage_changed_at.isoformat() if row.stage_changed_at else None,
        "closed_at": row.closed_at.isoformat() if row.closed_at else None,
        "folder_id": str(row.folder_id) if row.folder_id else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "can_edit": principal.can(MANAGE),
        "fields": [{"name": n, "label": LABELS[n], "kind": k} for n, k in FIELDS.items()],
    }


# ── reads ────────────────────────────────────────────────────────────────


def _base():
    from src.models.records_analytics import Contract

    return select(Contract).where(Contract.deleted_at.is_(None))


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


def _load(session, contract_id: Any):
    from src.models.records_analytics import Contract

    row = session.scalars(
        _base().where(Contract.id == parse_uuid(contract_id, field="contract_id"))
    ).first()
    if row is None:
        raise NotFoundError("That contract does not exist.", details={"id": str(contract_id)})
    return row


def load(session, contract_id: Any):
    """Exported for version history: the live row, or a 404."""
    return _load(session, contract_id)


# ── writes ───────────────────────────────────────────────────────────────


def _next_reference(session) -> str:
    from src.models.records_analytics import Contract

    highest = session.scalar(select(func.max(Contract.reference)).where(Contract.reference.like("CTR-%")))
    return identifier("CTR", sequence_of(highest, prefix="CTR") + 1, width=5)


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.records_analytics import Contract

    principal.require(MANAGE)
    values = coerce(session, payload, creating=True)
    stage = values.get("stage") or "UPCOMING"
    values.setdefault("stage", stage)
    values.setdefault("probability", DEFAULT_PROBABILITY[stage])
    values.setdefault("owner_id", principal.user_id)
    values.setdefault("currency", "EUR")
    values.setdefault("billing", "ANNUAL")
    values.setdefault("notice_days", 60)
    values.setdefault("auto_renew", False)
    if "term_months" not in values:
        span = (values["end_date"] - values["start_date"]).days
        values["term_months"] = max(1, round(span / 30.44))
    for attempt in range(_ATTEMPTS):
        nested = session.begin_nested()
        row = Contract(reference=_next_reference(session), rank=_rank_at_end(session, stage),
                       stage_changed_at=now(), **values)
        if stage in CLOSED_STAGES:
            row.closed_at = now()
        _check_dates(row)
        session.add(row)
        try:
            session.flush()
        except IntegrityError as exc:
            nested.rollback()
            if attempt == _ATTEMPTS - 1:
                raise ConflictError("Could not allocate a contract reference. Try again.") from exc
            continue
        nested.commit()
        break
    audit.record(session, action="CREATE", resource_type="contract", resource_id=row.id,
                 resource_label=row.reference, principal=principal, after=state(row),
                 message=f"created contract {row.reference} — {row.title}")
    _rescore(session, row.customer_id)
    return _detail(session, row, principal)


def _rank_at_end(session, stage: str) -> float:
    from src.models.records_analytics import Contract

    highest = session.scalar(select(func.max(Contract.rank)).where(Contract.stage == stage, Contract.deleted_at.is_(None)))
    return float(highest or 0) + 1024.0


def _refuse_lost_race(row, expected: Any) -> None:
    if not expected:
        return
    try:
        seen = datetime.fromisoformat(str(expected).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError("expected_updated_at must be a timestamp.") from exc
    if seen.tzinfo is None:
        from datetime import timezone

        seen = seen.replace(tzinfo=timezone.utc)
    if abs((row.updated_at - seen).total_seconds()) > 1:
        raise ConflictError("Somebody else changed this contract while you were editing it.",
                            details={"id": str(row.id), "current": row.updated_at.isoformat()})


def apply(session, row, values: dict[str, Any], *, principal, action: str | None = None,
          message: str | None = None, metadata: dict[str, Any] | None = None) -> set[str]:
    """Set coerced values on a contract and audit what moved. Shared with restore."""
    before_all = state(row)
    previous_customer = row.customer_id
    if "stage" in values and values["stage"] != row.stage:
        row.stage_changed_at = now()
        row.closed_at = now() if values["stage"] in CLOSED_STAGES else None
        if "probability" not in values:
            values = {**values, "probability": DEFAULT_PROBABILITY[values["stage"]]}
    for name, value in values.items():
        setattr(row, name, value)
    _check_dates(row)
    after_all = state(row)
    changed = {name for name in values if before_all.get(name) != after_all.get(name)}
    if not changed:
        return changed
    row.updated_at = now()
    session.flush()
    audit.record(
        session,
        action=action or ("STATUS_CHANGE" if changed <= {"stage", "probability"} and "stage" in changed else "UPDATE"),
        resource_type="contract", resource_id=row.id, resource_label=row.reference, principal=principal,
        before={k: before_all[k] for k in changed}, after={k: after_all[k] for k in changed},
        message=message or (f"moved {row.reference} to {STAGE_LABELS[row.stage].lower()}"
                            if "stage" in changed else f"updated {row.reference} ({', '.join(sorted(changed))})"),
        metadata=metadata,
    )
    _rescore(session, row.customer_id)
    if previous_customer != row.customer_id:
        _rescore(session, previous_customer)
    return changed


def update(session, contract_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    row = _load(session, contract_id)
    _refuse_lost_race(row, (payload or {}).get("expected_updated_at") if isinstance(payload, dict) else None)
    values = coerce(session, payload, creating=False)
    if not values:
        raise ValidationError("Nothing to write.", details={"editable": sorted(FIELDS)})
    apply(session, row, values, principal=principal)
    return _detail(session, row, principal)


def move(session, contract_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """A drag on the board: a stage, and a place among the cards there."""
    from src.models.records_analytics import Contract

    principal.require(MANAGE)
    if not isinstance(payload, dict):
        raise ValidationError("The move must be a JSON object.")
    row = _load(session, contract_id)
    _refuse_lost_race(row, payload.get("expected_updated_at"))
    stage = str(payload.get("stage") or row.stage).upper()
    if stage not in STAGES:
        raise ValidationError("Unknown stage.", details={"stage": stage, "allowed": list(STAGES)})
    neighbours = session.scalars(
        _base().where(Contract.stage == stage, Contract.id != row.id).order_by(Contract.rank)
    ).all()
    before_id = str(payload.get("before_id") or "")
    index = next((i for i, n in enumerate(neighbours) if str(n.id) == before_id), len(neighbours))
    previous = neighbours[index - 1].rank if index > 0 else None
    following = neighbours[index].rank if index < len(neighbours) else None
    if previous is None and following is None:
        rank = 1024.0
    elif previous is None:
        rank = following - 1024.0
    elif following is None:
        rank = previous + 1024.0
    else:
        rank = (previous + following) / 2
    row.rank = rank
    values: dict[str, Any] = {"stage": stage}
    if payload.get("probability") not in (None, ""):
        values["probability"] = _value(session, "probability", "percent", payload.get("probability"))
    if stage == "CHURNED" and payload.get("churn_reason"):
        values["churn_reason"] = _value(session, "churn_reason", "text", payload.get("churn_reason"))
    changed = apply(session, row, values, principal=principal)
    if not changed:
        row.updated_at = now()
        session.flush()
    return _detail(session, row, principal)


def remove(session, contract_id: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    row = _load(session, contract_id)
    row.deleted_at = now()
    audit.record(session, action="DELETE", resource_type="contract", resource_id=row.id,
                 resource_label=row.reference, principal=principal,
                 before={"deleted": False}, after={"deleted": True}, message=f"deleted contract {row.reference}")
    session.flush()
    _rescore(session, row.customer_id)
    return {"id": str(row.id), "deleted": True, "reference": row.reference}


def _rescore(session, customer_id) -> None:
    from src.services.records import customer_health

    customer_health.recompute(session, notify=True, customer_ids=[customer_id])


# ── files ────────────────────────────────────────────────────────────────


def files(session, contract_id: Any, *, principal) -> dict[str, Any]:
    from src.models.content import FileObject

    principal.require(VIEW)
    row = _load(session, contract_id)
    items = []
    if row.folder_id:
        for item in session.scalars(
            select(FileObject).where(FileObject.folder_id == row.folder_id, FileObject.deleted_at.is_(None))
            .order_by(FileObject.created_at.desc())
        ):
            items.append({
                "id": str(item.id), "name": item.name, "extension": item.extension, "kind": item.kind,
                "size_bytes": item.size_bytes, "status": item.status,
                "owner": item.owner.full_name if item.owner else None,
                "created_at": item.created_at.isoformat() if item.created_at else None,
            })
    return {"folder_id": str(row.folder_id) if row.folder_id else None, "items": items,
            "can_upload": principal.can(MANAGE) and principal.can("files.manage")}


def ensure_folder(session, contract_id: Any, *, principal) -> dict[str, Any]:
    """The contract's folder, created on first upload under /Contracts."""
    from src.models.content import Folder

    principal.require(MANAGE, "files.manage")
    row = _load(session, contract_id)
    if row.folder_id is None:
        parent = session.scalars(
            select(Folder).where(Folder.path == "/Contracts", Folder.deleted_at.is_(None))
        ).first()
        if parent is None:
            parent = Folder(name="Contracts", path="/Contracts", owner_id=principal.user_id,
                            organization_id=principal.organization_id)
            session.add(parent)
            session.flush()
        path = f"/Contracts/{row.reference}"
        folder = session.scalars(select(Folder).where(Folder.path == path, Folder.deleted_at.is_(None))).first()
        if folder is None:
            folder = Folder(name=row.reference, path=path, parent_id=parent.id, owner_id=principal.user_id,
                            organization_id=principal.organization_id)
            session.add(folder)
            session.flush()
        row.folder_id = folder.id
        session.flush()
    return {"folder_id": str(row.folder_id)}


def _catch_up(session) -> None:
    from src.services.analytics import jobs as analytics_jobs

    analytics_jobs.catch_up(session)
