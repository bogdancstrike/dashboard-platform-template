"""Every customer's scoring inputs, gathered in a few queries."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import and_, case, func, or_, select

from src.services.records.customer_health.scoring_model import (
    CLOSED_TICKETS,
    DEFAULT_THRESHOLDS,
    VOID_ORDERS,
    _merged,
)
from src.services.records.customer_health.signals import Inputs


def gather(session, *, today: datetime, thresholds: dict[str, Any], customer_ids: list[UUID] | None = None) -> dict[UUID, Inputs]:
    """Every live customer's inputs, in one grouped query per signal."""
    from src.models.business import Customer, Device, Order, Project, Ticket
    from src.models.records_analytics import Contract

    t = _merged(DEFAULT_THRESHOLDS, thresholds)
    window = timedelta(days=int(t["orders"]["window_days"]))

    customers = select(Customer.id, Customer.last_contact_at).where(Customer.deleted_at.is_(None))
    if customer_ids is not None:
        customers = customers.where(Customer.id.in_(customer_ids))
    inputs: dict[UUID, Inputs] = {
        row.id: Inputs(last_contact_at=row.last_contact_at) for row in session.execute(customers)
    }
    if not inputs:
        return inputs
    ids = list(inputs)

    is_open = Ticket.status.notin_(CLOSED_TICKETS)
    tickets = session.execute(
        select(
            Ticket.customer_id,
            func.count().filter(is_open),
            func.count().filter(and_(is_open, or_(
                Ticket.status == "ESCALATED", Ticket.priority == "CRITICAL", Ticket.severity == "CRITICAL",
            ))),
            func.count().filter(and_(Ticket.sla_breached.is_(True), Ticket.created_at >= today - timedelta(days=90))),
        )
        .where(Ticket.deleted_at.is_(None), Ticket.customer_id.in_(ids))
        .group_by(Ticket.customer_id)
    )
    for customer_id, open_count, escalated, breached in tickets:
        row = inputs[customer_id]
        row.open_tickets, row.escalated, row.breached = int(open_count), int(escalated), int(breached)

    recent = Order.placed_at >= today - window
    previous = and_(Order.placed_at < today - window, Order.placed_at >= today - 2 * window)
    orders = session.execute(
        select(
            Order.customer_id,
            func.count().filter(recent),
            func.count().filter(previous),
            func.coalesce(func.sum(case((recent, Order.total), else_=0)), 0),
            func.coalesce(func.sum(case((previous, Order.total), else_=0)), 0),
            func.max(Order.placed_at),
        )
        .where(Order.deleted_at.is_(None), Order.status.notin_(VOID_ORDERS), Order.customer_id.in_(ids))
        .group_by(Order.customer_id)
    )
    for customer_id, n_recent, n_previous, v_recent, v_previous, last in orders:
        row = inputs[customer_id]
        row.orders_recent, row.orders_previous = int(n_recent), int(n_previous)
        row.value_recent, row.value_previous = float(v_recent or 0), float(v_previous or 0)
        row.last_order_at = last

    devices = session.execute(
        select(
            Project.customer_id,
            func.count(Device.id),
            func.count(Device.id).filter(Device.status == "ONLINE"),
            func.coalesce(func.sum(Device.error_count), 0),
        )
        .join(Project, Project.id == Device.project_id)
        .where(
            Device.deleted_at.is_(None), Device.status != "DECOMMISSIONED",
            Project.customer_id.in_(ids),
        )
        .group_by(Project.customer_id)
    )
    for customer_id, total, online, errors in devices:
        row = inputs[customer_id]
        row.devices, row.devices_online, row.device_errors = int(total), int(online), int(errors)

    # The contract that matters is the next one to end that is still being
    # worked; failing that, the most recently closed.
    contracts = session.scalars(
        select(Contract).where(Contract.deleted_at.is_(None), Contract.customer_id.in_(ids))
        .order_by(Contract.end_date)
    ).all()
    chosen: dict[UUID, Any] = {}
    for contract in contracts:
        current = chosen.get(contract.customer_id)
        open_now = contract.stage not in ("RENEWED", "CHURNED")
        if current is None:
            chosen[contract.customer_id] = contract
            continue
        current_open = current.stage not in ("RENEWED", "CHURNED")
        if open_now and not current_open:
            chosen[contract.customer_id] = contract
        elif open_now == current_open and not open_now and contract.end_date > current.end_date:
            chosen[contract.customer_id] = contract
    for customer_id, contract in chosen.items():
        inputs[customer_id].contract = {
            "id": str(contract.id),
            "reference": contract.reference,
            "stage": contract.stage,
            "probability": int(contract.probability or 0),
            "end_date": contract.end_date.isoformat(),
            "days_to_end": (contract.end_date - today.date()).days,
            "value": float(contract.value or 0),
        }
    return inputs
