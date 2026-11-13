"""Contracts as the API returns them."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import select

from src.core.clock import now
from src.services.records.contracts.fields import (
    AT_RISK_BANDS,
    FIELDS,
    LABELS,
    MANAGE,
    OPEN_STAGES,
    STAGE_LABELS,
)


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
