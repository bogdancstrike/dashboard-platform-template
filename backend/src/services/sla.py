"""SLA policies: which tickets, what targets, counted in whose hours.

**The first active policy that matches wins.** Policies are ordered; each names
conditions on the ticket and its customer (customer, segment, category,
channel) and an empty condition set matches everything — so the last policy is
usually the catch-all.

**Targets are business minutes.** "Four hours" on a Friday at 16:00 in a
09:00–17:00 calendar is Monday at 11:00, not Friday at 20:00. The calendar
carries a time zone, its working spans per weekday and its holidays; a policy
without one counts every minute.

**Waiting on the customer stops the clock.** The statuses a policy names as
pauses accumulate business minutes in `paused_minutes`, and the resolution
deadline moves by exactly that much.

**The ticket still carries the answer.** `tickets.due_at` and `sla_breached`
are written from the computation, so every list, report and dashboard that
already reads them now reads the policy — without knowing it exists.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

from sqlalchemy import func, select

from src.core import audit, vocabulary
from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import get_or_404
from src.models.sla import BusinessCalendar, SlaPolicy, TicketSla
from src.services import record_writes

MANAGE = "sla.manage"
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
ACTIONS = ("NOTIFY", "ASSIGN", "RAISE_PRIORITY")
NOTIFY_TARGETS = ("assignee", "manager", "user")
CONDITION_KEYS = ("customer_ids", "segments", "categories", "channels")
CLOSED = ("RESOLVED", "CLOSED")
#: How far ahead a deadline is searched for before giving up.
MAX_DAYS = 800


# ── Business time ───────────────────────────────────────────────────────


def _zone(calendar: BusinessCalendar | None) -> ZoneInfo:
    try:
        return ZoneInfo(calendar.timezone if calendar else "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _parse_hm(value: str) -> time:
    hours, minutes = str(value).split(":")
    return time(int(hours) % 24, int(minutes))


def _spans(calendar: BusinessCalendar, day: date, zone: ZoneInfo) -> list[tuple[datetime, datetime]]:
    """The working spans of one local day, as aware datetimes."""
    holidays = {str(item.get("date")) for item in (calendar.holidays or []) if isinstance(item, dict)}
    if day.isoformat() in holidays:
        return []
    spans = []
    for pair in (calendar.hours or {}).get(DAYS[day.weekday()], []) or []:
        start, end = _parse_hm(pair[0]), _parse_hm(pair[1])
        begin = datetime.combine(day, start, zone)
        finish = datetime.combine(day, end, zone) if end > start else datetime.combine(
            day + timedelta(days=1), time(0, 0), zone)
        spans.append((begin, finish))
    return sorted(spans)


def add_business_minutes(calendar: BusinessCalendar | None, start: datetime, minutes: int) -> datetime:
    """The moment `minutes` of working time after `start`."""
    if calendar is None:
        return start + timedelta(minutes=minutes)
    zone = _zone(calendar)
    local = start.astimezone(zone)
    remaining = timedelta(minutes=max(0, minutes))
    day = local.date()
    for _ in range(MAX_DAYS):
        for begin, finish in _spans(calendar, day, zone):
            if finish <= local:
                continue
            begin = max(begin, local)
            available = finish - begin
            if remaining <= available:
                return begin + remaining
            remaining -= available
        day += timedelta(days=1)
    return start + timedelta(minutes=minutes)  # a calendar with no working hours at all


def business_minutes_between(calendar: BusinessCalendar | None, start: datetime, end: datetime) -> int:
    """Working minutes from `start` to `end`; negative when `end` is earlier."""
    if end < start:
        return -business_minutes_between(calendar, end, start)
    if calendar is None:
        return int((end - start).total_seconds() // 60)
    zone = _zone(calendar)
    local_start, local_end = start.astimezone(zone), end.astimezone(zone)
    total = timedelta()
    day = local_start.date()
    for _ in range(MAX_DAYS):
        if day > local_end.date():
            break
        for begin, finish in _spans(calendar, day, zone):
            overlap = min(finish, local_end) - max(begin, local_start)
            if overlap > timedelta():
                total += overlap
        day += timedelta(days=1)
    return int(total.total_seconds() // 60)


def is_open_now(calendar: BusinessCalendar | None, moment: datetime) -> bool:
    if calendar is None:
        return True
    zone = _zone(calendar)
    local = moment.astimezone(zone)
    return any(begin <= local < finish for begin, finish in _spans(calendar, local.date(), zone))


# ── Matching and computing ──────────────────────────────────────────────


def _policies(session) -> list[SlaPolicy]:
    return list(session.scalars(
        select(SlaPolicy).where(SlaPolicy.deleted_at.is_(None))
        .order_by(SlaPolicy.position, SlaPolicy.created_at)
    ).unique())


def matches(policy: SlaPolicy, ticket, customer) -> bool:
    conditions = policy.conditions or {}
    if conditions.get("customer_ids") and str(ticket.customer_id) not in {
        str(item) for item in conditions["customer_ids"]
    }:
        return False
    if conditions.get("segments") and (customer is None or customer.segment not in conditions["segments"]):
        return False
    if conditions.get("categories") and ticket.category not in conditions["categories"]:
        return False
    if conditions.get("channels") and ticket.channel not in conditions["channels"]:
        return False
    return True


def policy_for(session, ticket, *, policies: list[SlaPolicy] | None = None) -> SlaPolicy | None:
    customer = ticket.customer if ticket.customer_id else None
    for policy in policies if policies is not None else _policies(session):
        if policy.active and matches(policy, ticket, customer):
            return policy
    return None


def _target(policy: SlaPolicy | None, priority: str) -> dict[str, int]:
    if policy is None:
        return {}
    raw = (policy.targets or {}).get(priority) or {}
    return {key: int(raw[key]) for key in ("first_response", "resolution") if raw.get(key)}


def _state(session, ticket) -> TicketSla:
    state = session.scalars(select(TicketSla).where(TicketSla.ticket_id == ticket.id)).first()
    if state is None:
        state = TicketSla(ticket_id=ticket.id, paused_minutes=0, escalations_fired=[])
        session.add(state)
    return state


def compute(session, ticket, *, moment: datetime | None = None, policies=None, sweep: bool = True) -> TicketSla:
    """Recompute one ticket's clock, and write its deadline and breach flag."""
    moment = moment or now()
    state = _state(session, ticket)
    policy = policy_for(session, ticket, policies=policies)
    if state.policy_id != (policy.id if policy else None):
        state.escalations_fired = []
    state.policy_id = policy.id if policy else None
    state.policy = policy
    calendar = policy.calendar if policy else None

    paused_statuses = set((policy.pause_statuses if policy else None) or [])
    if ticket.status in paused_statuses and ticket.status not in CLOSED:
        if state.paused_since is None:
            state.paused_since = moment
    elif state.paused_since is not None:
        state.paused_minutes = (state.paused_minutes or 0) + max(
            0, business_minutes_between(calendar, state.paused_since, moment))
        state.paused_since = None

    target = _target(policy, ticket.priority)
    created = clock_start(ticket, policy, moment)
    state.first_response_due_at = (
        add_business_minutes(calendar, created, target["first_response"])
        if "first_response" in target else None
    )
    if "resolution" in target:
        state.resolution_due_at = add_business_minutes(
            calendar, created, target["resolution"] + (state.paused_minutes or 0))
    else:
        state.resolution_due_at = None
    state.computed_at = moment

    if policy is not None:
        ticket.due_at = state.resolution_due_at
        finished = ticket.resolved_at if ticket.status in CLOSED and ticket.resolved_at else None
        if state.resolution_due_at is None:
            ticket.sla_breached = False
        elif state.paused_since is not None:
            ticket.sla_breached = state.paused_since > state.resolution_due_at
        else:
            ticket.sla_breached = (finished or moment) > state.resolution_due_at
    session.flush()
    if sweep and policy is not None and ticket.status not in CLOSED:
        _escalate(session, ticket, state, policy, moment)
    return state


def clock_start(ticket, policy: SlaPolicy | None, moment: datetime | None = None) -> datetime:
    """When the clock started: the ticket's arrival, or the policy's, if later.

    A policy is a promise made from the day it exists. Measuring a ticket
    raised a quarter ago against a target written this morning would report
    every old ticket as breached on the day the policy was introduced, which
    is a statement about the policy rather than about the service.
    """
    created = ticket.created_at or moment or now()
    since = getattr(policy, "created_at", None) if policy is not None else None
    return max(created, since) if since else created


#: Changes that move a ticket's clock.
CLOCK_FIELDS = {"status", "priority", "customer_id", "category", "channel", "resolved_at",
                "first_response_at", "subject"}


@record_writes.derived.connect
def _on_record_write(session, resource, row, changed: set[str]) -> None:
    if resource.key == "ticket":
        on_ticket_write(session, row, changed)


def on_ticket_write(session, ticket, changed: set[str]) -> None:
    """The record-write hook: a new ticket, or one whose clock inputs moved."""
    if changed & CLOCK_FIELDS:
        compute(session, ticket)


def recompute_all(session, *, only_open: bool = False) -> dict[str, int]:
    from src.models.business import Ticket

    policies = _policies(session)
    clauses = [Ticket.deleted_at.is_(None)]
    if only_open:
        clauses.append(Ticket.status.notin_(CLOSED))
    tickets = session.scalars(select(Ticket).where(*clauses)).unique().all()
    moment = now()
    covered = 0
    for ticket in tickets:
        state = compute(session, ticket, moment=moment, policies=policies, sweep=False)
        covered += 1 if state.policy_id else 0
    return {"tickets": len(tickets), "covered": covered}


def _percent(state: TicketSla, policy: SlaPolicy, ticket, moment: datetime) -> float | None:
    target = _target(policy, ticket.priority).get("resolution")
    if not target:
        return None
    spent = business_minutes_between(policy.calendar, clock_start(ticket, policy, moment), moment) - (state.paused_minutes or 0)
    if state.paused_since is not None:
        spent -= business_minutes_between(policy.calendar, state.paused_since, moment)
    return max(0.0, spent * 100.0 / target)


def _escalate(session, ticket, state: TicketSla, policy: SlaPolicy, moment: datetime) -> list[int]:
    from src.models.identity import User
    from src.services import notifications

    percent = _percent(state, policy, ticket, moment)
    if percent is None:
        return []
    fired = set(state.escalations_fired or [])
    newly = []
    for index, step in enumerate(policy.escalations or []):
        if index in fired or percent < float(step.get("at_percent") or 0):
            continue
        action = step.get("action")
        target_user = None
        if step.get("target") == "assignee":
            target_user = ticket.assignee_id
        elif step.get("target") == "manager" and ticket.assignee_id:
            assignee = session.get(User, ticket.assignee_id)
            target_user = assignee.manager_id if assignee else None
        elif step.get("user_id"):
            target_user = parse_uuid(step.get("user_id"), field="user_id")
        if action == "NOTIFY" and target_user:
            notifications.publish(
                session, user_id=target_user,
                title=f"{ticket.reference} is at {int(step.get('at_percent'))}% of its SLA",
                category="ALERT", severity="CRITICAL" if percent >= 100 else "WARNING",
                body=f"{policy.name}: {ticket.subject}", link=f"/tickets/{ticket.id}",
                icon="alert-triangle", resource_type="ticket", resource_id=str(ticket.id),
                group_key=f"sla:{ticket.id}",
            )
        elif action == "ASSIGN" and target_user:
            ticket.assignee_id = target_user
        elif action == "RAISE_PRIORITY":
            order = list(vocabulary.PRIORITY)
            if ticket.priority in order and order.index(ticket.priority) < len(order) - 1:
                ticket.priority = order[order.index(ticket.priority) + 1]
        newly.append(index)
        audit.record(session, action="ESCALATE", resource_type="ticket", resource_id=ticket.id,
                     resource_label=ticket.reference, principal=None,
                     after={"step": index, "action": action, "percent": round(percent)},
                     message=f"SLA escalation: {action.lower().replace('_', ' ')} at {round(percent)}%",
                     activity=False)
    if newly:
        state.escalations_fired = sorted(fired | set(newly))
        session.flush()
    return newly


def sweep(session, *, principal) -> dict[str, int]:
    """Fire every escalation step that is due, across open tickets."""
    principal.require(MANAGE)
    from src.models.business import Ticket

    moment = now()
    fired = 0
    rows = session.execute(
        select(Ticket, TicketSla).join(TicketSla, TicketSla.ticket_id == Ticket.id)
        .where(Ticket.deleted_at.is_(None), Ticket.status.notin_(CLOSED), TicketSla.policy_id.is_not(None))
    ).unique().all()
    for ticket, state in rows:
        if state.policy is not None:
            fired += len(_escalate(session, ticket, state, state.policy, moment))
    return {"checked": len(rows), "fired": fired}


# ── The ticket's view ───────────────────────────────────────────────────


def _clock(calendar, due: datetime | None, done: datetime | None, moment: datetime,
           paused: bool) -> dict[str, Any] | None:
    if due is None:
        return None
    reference = done or moment
    return {
        "due_at": iso(due),
        "met": done is not None and done <= due,
        "breached": reference > due and not (paused and done is None),
        "done_at": iso(done),
        "business_minutes_left": None if done else business_minutes_between(calendar, moment, due),
    }


def for_ticket(session, ticket_id: Any, *, principal) -> dict[str, Any]:
    principal.require("records.view")
    from src.models.business import Ticket

    ticket = get_or_404(
        session,
        Ticket,
        parse_uuid(ticket_id, field="ticket_id"),
        "That ticket does not exist.",
        live=True,
    )
    state = session.scalars(select(TicketSla).where(TicketSla.ticket_id == ticket.id)).first()
    if state is None:
        state = compute(session, ticket, sweep=False)
    policy = state.policy
    calendar = policy.calendar if policy else None
    moment = now()
    paused = state.paused_since is not None
    target = _target(policy, ticket.priority)
    finished = ticket.resolved_at if ticket.status in CLOSED else None
    return {
        "ticket_id": str(ticket.id),
        "policy": None if policy is None else {"id": str(policy.id), "name": policy.name,
                                               "description": policy.description or ""},
        "calendar": None if calendar is None else {"id": str(calendar.id), "name": calendar.name,
                                                   "timezone": calendar.timezone},
        "priority": ticket.priority,
        "targets": target,
        "first_response": _clock(calendar, state.first_response_due_at, ticket.first_response_at,
                                 moment, False),
        "resolution": _clock(calendar, state.resolution_due_at, finished, moment, paused),
        "paused": paused,
        "paused_since": iso(state.paused_since),
        "paused_minutes": state.paused_minutes or 0,
        "pause_statuses": list((policy.pause_statuses if policy else None) or []),
        "percent_elapsed": None if policy is None or finished else (
            None if (pct := _percent(state, policy, ticket, moment)) is None else round(pct, 1)),
        "in_business_hours": is_open_now(calendar, moment),
        "escalations": [
            {**step, "fired": index in set(state.escalations_fired or [])}
            for index, step in enumerate((policy.escalations if policy else None) or [])
        ],
        "computed_at": iso(state.computed_at),
    }


# ── Administration ──────────────────────────────────────────────────────


def _calendar_body(row: BusinessCalendar, *, used_by: int = 0) -> dict[str, Any]:
    hours = row.hours or {}
    weekly = 0
    for day in DAYS:
        for pair in hours.get(day, []) or []:
            start, end = _parse_hm(pair[0]), _parse_hm(pair[1])
            close = end.hour * 60 + end.minute or 24 * 60
            weekly += close - (start.hour * 60 + start.minute)
    return {"id": str(row.id), "name": row.name, "timezone": row.timezone, "hours": hours,
            "holidays": row.holidays or [], "is_default": row.is_default,
            "weekly_minutes": weekly, "used_by": used_by, "updated_at": iso(row.updated_at)}


def _policy_body(row: SlaPolicy, *, covered: int = 0, breached: int = 0) -> dict[str, Any]:
    return {
        "id": str(row.id), "name": row.name, "description": row.description or "",
        "position": row.position, "active": row.active, "conditions": row.conditions or {},
        "targets": row.targets or {}, "calendar_id": str(row.calendar_id) if row.calendar_id else None,
        "calendar_name": row.calendar.name if row.calendar else None,
        "pause_statuses": row.pause_statuses or [], "escalations": row.escalations or [],
        "covered_open": covered, "breached_open": breached, "updated_at": iso(row.updated_at),
    }


def catalogue(session, *, principal) -> dict[str, Any]:
    principal.require("records.view")
    from src.models.business import Customer

    customers = session.execute(
        select(Customer.id, Customer.name, Customer.segment).where(Customer.deleted_at.is_(None))
        .order_by(Customer.name).limit(500)
    ).all()
    zones = sorted(z for z in available_timezones() if "/" in z and not z.startswith(("Etc/", "SystemV")))
    return {
        "priorities": list(vocabulary.PRIORITY),
        "categories": list(vocabulary.TICKET_CATEGORY),
        "channels": list(vocabulary.TICKET_CHANNEL),
        "segments": list(vocabulary.CUSTOMER_SEGMENT),
        "statuses": list(vocabulary.TICKET_STATUS),
        "actions": list(ACTIONS),
        "notify_targets": list(NOTIFY_TARGETS),
        "days": list(DAYS),
        "timezones": ["UTC", *zones],
        "customers": [{"id": str(ident), "name": name, "segment": segment} for ident, name, segment in customers],
        "can_manage": principal.can(MANAGE),
    }


def policies(session, *, principal) -> dict[str, Any]:
    principal.require("records.view")
    from src.models.business import Ticket

    counts = {
        policy_id: (int(total), int(late))
        for policy_id, total, late in session.execute(
            select(TicketSla.policy_id, func.count(),
                   func.count().filter(Ticket.sla_breached.is_(True)))
            .join(Ticket, Ticket.id == TicketSla.ticket_id)
            .where(Ticket.deleted_at.is_(None), Ticket.status.notin_(CLOSED))
            .group_by(TicketSla.policy_id)
        ).all()
    }
    rows = _policies(session)
    calendars = session.scalars(
        select(BusinessCalendar).where(BusinessCalendar.deleted_at.is_(None)).order_by(BusinessCalendar.name)
    ).all()
    uses = {}
    for row in rows:
        if row.calendar_id:
            uses[row.calendar_id] = uses.get(row.calendar_id, 0) + 1
    uncovered = counts.get(None, (0, 0))[0]
    return {
        "items": [_policy_body(row, covered=counts.get(row.id, (0, 0))[0],
                               breached=counts.get(row.id, (0, 0))[1]) for row in rows],
        "calendars": [_calendar_body(cal, used_by=uses.get(cal.id, 0)) for cal in calendars],
        "uncovered_open": uncovered,
        "can_manage": principal.can(MANAGE),
    }


def policy(session, ident: Any, *, principal) -> dict[str, Any]:
    principal.require("records.view")
    row = _policy_row(session, ident)
    return _policy_body(row)


def _policy_row(session, ident: Any) -> SlaPolicy:
    row = get_or_404(
        session,
        SlaPolicy,
        parse_uuid(ident, field="policy_id"),
        "That SLA policy does not exist.",
        live=True,
    )
    return row


def _minutes(value: Any, *, field: str) -> int | None:
    if value in (None, ""):
        return None
    try:
        minutes = int(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{field} must be a number of minutes.", details={"field": field}) from exc
    if minutes <= 0 or minutes > 60 * 24 * 365:
        raise ValidationError(f"{field} must be a positive number of minutes.", details={"field": field})
    return minutes


def _checked_policy(session, payload: dict[str, Any], row: SlaPolicy) -> None:
    name = str(payload.get("name", row.name or "")).strip()
    if not name:
        raise ValidationError("Give the policy a name.", details={"field": "name"})
    row.name = name[:160]
    row.description = str(payload.get("description", row.description or "")).strip() or None
    row.active = bool(payload.get("active", True if row.active is None else row.active))
    row.conditions = _conditions(payload.get("conditions", row.conditions or {}) or {})
    row.targets = _targets(payload.get("targets", row.targets or {}) or {})
    calendar = _calendar_choice(
        session, payload.get("calendar_id", str(row.calendar_id) if row.calendar_id else None)
    )
    row.calendar_id = calendar.id if calendar is not None else None
    row.calendar = calendar
    row.pause_statuses = _pauses(payload.get("pause_statuses", row.pause_statuses or []) or [])
    steps = [_step(index, step) for index, step in
             enumerate(payload.get("escalations", row.escalations or []) or [])]
    row.escalations = sorted(steps, key=lambda item: item["at_percent"])


_CONDITION_VALUES = {"segments": vocabulary.CUSTOMER_SEGMENT,
                     "categories": vocabulary.TICKET_CATEGORY,
                     "channels": vocabulary.TICKET_CHANNEL}


def _conditions(raw: Any) -> dict[str, list[str]]:
    if not isinstance(raw, dict):
        raise ValidationError("conditions must be an object.", details={"field": "conditions"})
    conditions: dict[str, list[str]] = {}
    for key, values in raw.items():
        if key not in CONDITION_KEYS:
            raise ValidationError(f"{key!r} is not a condition.", details={"field": "conditions"})
        values = [str(item) for item in (values or [])]
        allowed = _CONDITION_VALUES.get(key)
        if allowed is not None and any(item not in allowed for item in values):
            raise ValidationError(f"Unknown value in {key}.", details={"field": f"conditions.{key}"})
        if key == "customer_ids":
            values = [str(parse_uuid(item, field="customer_ids")) for item in values]
        if values:
            conditions[key] = values
    return conditions


def _targets(raw: dict[str, Any]) -> dict[str, dict[str, int]]:
    targets: dict[str, dict[str, int]] = {}
    for priority, pair in raw.items():
        if priority not in vocabulary.PRIORITY:
            raise ValidationError(f"{priority!r} is not a priority.", details={"field": "targets"})
        first = _minutes((pair or {}).get("first_response"), field=f"targets.{priority}.first_response")
        resolution = _minutes((pair or {}).get("resolution"), field=f"targets.{priority}.resolution")
        if first and resolution and first > resolution:
            raise ValidationError(f"{priority.title()}: the first response cannot be due after resolution.",
                                  details={"field": f"targets.{priority}"})
        entry = {key: value for key, value in (("first_response", first), ("resolution", resolution)) if value}
        if entry:
            targets[priority] = entry
    return targets


def _calendar_choice(session, calendar_id: Any) -> BusinessCalendar | None:
    if not calendar_id:
        return None
    calendar = session.get(BusinessCalendar, parse_uuid(calendar_id, field="calendar_id"))
    if calendar is None or calendar.deleted_at is not None:
        raise ValidationError("That calendar does not exist.", details={"field": "calendar_id"})
    return calendar


def _pauses(raw: Any) -> list[str]:
    pauses = [str(item) for item in raw]
    if any(item not in vocabulary.TICKET_STATUS or item in CLOSED for item in pauses):
        raise ValidationError("Pause only on open ticket statuses.", details={"field": "pause_statuses"})
    return pauses


def _step(index: int, step: Any) -> dict[str, Any]:
    step = step or {}

    def refuse(message: str) -> ValidationError:
        return ValidationError(f"Step {index + 1}: {message}", details={"field": "escalations"})

    action = str(step.get("action") or "").upper()
    if action not in ACTIONS:
        raise refuse("unknown action.")
    try:
        at = int(step.get("at_percent"))
    except (TypeError, ValueError) as exc:
        raise refuse("give a percentage.") from exc
    if at < 1 or at > 500:
        raise refuse("between 1% and 500%.")
    clean: dict[str, Any] = {"at_percent": at, "action": action}
    if action in ("NOTIFY", "ASSIGN"):
        target = str(step.get("target") or "assignee")
        if target not in NOTIFY_TARGETS:
            raise refuse("unknown target.")
        clean["target"] = target
        if target == "user":
            clean["user_id"] = str(parse_uuid(step.get("user_id"), field="user_id"))
    return clean


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


def _calendar_row(session, ident: Any) -> BusinessCalendar:
    row = get_or_404(
        session,
        BusinessCalendar,
        parse_uuid(ident, field="calendar_id"),
        "That calendar does not exist.",
        live=True,
    )
    return row


def _checked_calendar(payload: dict[str, Any], row: BusinessCalendar) -> None:
    name = str(payload.get("name", row.name or "")).strip()
    if not name:
        raise ValidationError("Give the calendar a name.", details={"field": "name"})
    row.name = name[:120]
    zone = str(payload.get("timezone", row.timezone or "UTC"))
    try:
        ZoneInfo(zone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValidationError(f"{zone!r} is not a time zone.", details={"field": "timezone"}) from exc
    row.timezone = zone
    hours_in = payload.get("hours", row.hours or {}) or {}
    hours: dict[str, list[list[str]]] = {}
    for day in DAYS:
        spans = []
        for pair in hours_in.get(day, []) or []:
            try:
                start, end = _parse_hm(pair[0]), _parse_hm(pair[1])
            except (TypeError, ValueError, IndexError) as exc:
                raise ValidationError(f"{day}: times look like 09:00.", details={"field": f"hours.{day}"}) from exc
            if end <= start and not (end.hour == 0 and end.minute == 0):
                raise ValidationError(f"{day}: a span must end after it starts.", details={"field": f"hours.{day}"})
            spans.append([start.strftime("%H:%M"), end.strftime("%H:%M")])
        hours[day] = sorted(spans)
    if not any(hours.values()):
        raise ValidationError("A calendar needs at least one working span.", details={"field": "hours"})
    row.hours = hours
    holidays = []
    for item in payload.get("holidays", row.holidays or []) or []:
        try:
            day = date.fromisoformat(str((item or {}).get("date")))
        except (TypeError, ValueError) as exc:
            raise ValidationError("Holidays need a date (YYYY-MM-DD).", details={"field": "holidays"}) from exc
        holidays.append({"date": day.isoformat(), "name": str((item or {}).get("name") or "Holiday")[:80]})
    row.holidays = sorted(holidays, key=lambda item: item["date"])
    if "is_default" in payload:
        row.is_default = bool(payload.get("is_default"))


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
