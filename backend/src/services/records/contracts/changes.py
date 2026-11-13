"""Creating, changing and moving contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from src.core import audit
from src.core.clock import now
from src.core.errors import ConflictError, ValidationError
from src.core.naming import identifier, sequence_of
from src.services.records.contracts.fields import (
    _ATTEMPTS,
    CLOSED_STAGES,
    DEFAULT_PROBABILITY,
    FIELDS,
    MANAGE,
    STAGE_LABELS,
    STAGES,
    _base,
    _check_dates,
    _load,
    _value,
    coerce,
)
from src.services.records.contracts.lifecycle import _rescore
from src.services.records.contracts.serializers import _detail, state


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
