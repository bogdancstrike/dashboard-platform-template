"""Saving, deleting and reordering policies and calendars."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core import audit
from src.core.clock import now
from src.core.errors import ValidationError
from src.models.sla import BusinessCalendar, SlaPolicy, TicketSla
from src.services.decisions.sla.business_hours import MANAGE
from src.services.decisions.sla.clocks import _policies
from src.services.decisions.sla.escalation import sweep
from src.services.decisions.sla.policy_checks import _checked_calendar, _checked_policy
from src.services.decisions.sla.policy_reads import (
    _calendar_body,
    _calendar_row,
    _policy_body,
    _policy_row,
    policies,
)
from src.services.decisions.sla.ticket_hooks import recompute_all


def save_policy(session, payload: dict[str, Any], *, principal, ident: Any = None) -> dict[str, Any]:
    principal.require(MANAGE)
    if ident:
        row = _policy_row(session, ident)
        before = _policy_body(row)
    else:
        top = session.scalar(select(func.max(SlaPolicy.position)).where(SlaPolicy.deleted_at.is_(None)))
        row = SlaPolicy(position=(top or 0) + 1, active=True)
        before = None
    _checked_policy(session, payload, row)
    if not ident:
        session.add(row)
    session.flush()
    result = recompute_all(session)
    audit.record(session, action="CONFIGURATION_CHANGE" if ident else "CREATE", resource_type="sla_policy",
                 resource_id=row.id, resource_label=row.name, principal=principal, before=before,
                 after=_policy_body(row), message=f"saved SLA policy {row.name}")
    return {**_policy_body(row), "recomputed": result}


def delete_policy(session, ident: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    row = _policy_row(session, ident)
    row.deleted_at = now()
    row.active = False
    session.flush()
    for state in session.scalars(select(TicketSla).where(TicketSla.policy_id == row.id)).all():
        state.policy_id = None
    session.flush()
    result = recompute_all(session)
    audit.record(session, action="DELETE", resource_type="sla_policy", resource_id=row.id,
                 resource_label=row.name, principal=principal, message=f"removed SLA policy {row.name}")
    return {"id": str(row.id), "removed": True, "recomputed": result}


def reorder(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    ids = [str(item) for item in payload.get("ids") or []]
    rows = {str(row.id): row for row in _policies(session)}
    if sorted(ids) != sorted(rows):
        raise ValidationError("Send every policy id, once, in the new order.", details={"field": "ids"})
    for position, ident in enumerate(ids, start=1):
        rows[ident].position = position
    session.flush()
    result = recompute_all(session)
    return {**policies(session, principal=principal), "recomputed": result}


def save_calendar(session, payload: dict[str, Any], *, principal, ident: Any = None) -> dict[str, Any]:
    principal.require(MANAGE)
    row = _calendar_row(session, ident) if ident else BusinessCalendar(is_default=False)
    _checked_calendar(payload, row)
    if not ident:
        session.add(row)
    session.flush()
    result = recompute_all(session) if ident else None
    audit.record(session, action="CONFIGURATION_CHANGE" if ident else "CREATE", resource_type="business_calendar",
                 resource_id=row.id, resource_label=row.name, principal=principal,
                 after=_calendar_body(row), message=f"saved business calendar {row.name}")
    return {**_calendar_body(row), "recomputed": result}


def delete_calendar(session, ident: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    row = _calendar_row(session, ident)
    users = session.scalar(select(func.count()).select_from(SlaPolicy).where(
        SlaPolicy.calendar_id == row.id, SlaPolicy.deleted_at.is_(None))) or 0
    if users:
        raise ValidationError(f"{users} polic{'y uses' if users == 1 else 'ies use'} this calendar.",
                              details={"used_by": users})
    row.deleted_at = now()
    audit.record(session, action="DELETE", resource_type="business_calendar", resource_id=row.id,
                 resource_label=row.name, principal=principal, message=f"removed business calendar {row.name}")
    return {"id": str(row.id), "removed": True}


def apply_now(session, *, principal) -> dict[str, Any]:
    principal.require(MANAGE)
    result = recompute_all(session)
    return {**result, **{"escalations": sweep(session, principal=principal)}}
