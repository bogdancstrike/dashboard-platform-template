"""Contract stages, billing, currencies, and a contract's fields coerced."""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import func, select

from src.core.errors import NotFoundError, ValidationError
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


def _base():
    from src.models.records_analytics import Contract

    return select(Contract).where(Contract.deleted_at.is_(None))


def _load(session, contract_id: Any):
    from src.models.records_analytics import Contract

    row = session.scalars(
        _base().where(Contract.id == parse_uuid(contract_id, field="contract_id"))
    ).first()
    if row is None:
        raise NotFoundError("That contract does not exist.", details={"id": str(contract_id)})
    return row
