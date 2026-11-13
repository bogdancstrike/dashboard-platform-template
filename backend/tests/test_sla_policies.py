"""SLA policies: business hours, first match wins, pauses, escalations.

The arithmetic is tested against fixed instants, because its cases are
boundaries — a target that crosses a weekend, a holiday, the end of a day.
The policy tests then show a change in the editor reaching a real ticket:
its deadline and breach flag move, and its page says which policy applies.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from src.config import Config
from src.core.db import session_scope
from src.models.sla import BusinessCalendar
from src.services import sla
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
SLA = f"{PREFIX}/api/sla"

OFFICE = BusinessCalendar(
    name="Office", timezone="Europe/Berlin",
    hours={day: [["09:00", "17:00"]] for day in ("mon", "tue", "wed", "thu", "fri")},
    holidays=[{"date": "2026-12-25", "name": "Christmas Day"}],
)


def _at(text: str) -> datetime:
    return datetime.fromisoformat(text)


def test_business_minutes_skip_the_night_the_weekend_and_holidays():
    friday_late = _at("2026-11-13T15:00:00+00:00")  # 16:00 in Berlin
    # Two working hours from Friday 16:00 is Monday 10:00 Berlin = 09:00 UTC.
    assert sla.add_business_minutes(OFFICE, friday_late, 120) == _at("2026-11-16T09:00:00+00:00")
    # Before opening, the clock starts at nine.
    assert sla.add_business_minutes(OFFICE, _at("2026-11-16T05:00:00+00:00"), 30) == _at("2026-11-16T08:30:00+00:00")
    # Christmas Day is skipped.
    christmas_eve = _at("2026-12-24T15:00:00+00:00")
    assert sla.add_business_minutes(OFFICE, christmas_eve, 120).date().isoformat() == "2026-12-28"
    assert sla.business_minutes_between(OFFICE, friday_late, _at("2026-11-16T09:00:00+00:00")) == 120
    assert sla.business_minutes_between(OFFICE, _at("2026-11-16T09:00:00+00:00"), friday_late) == -120
    assert sla.business_minutes_between(None, friday_late, friday_late + timedelta(minutes=90)) == 90
    assert sla.add_business_minutes(None, friday_late, 10) == friday_late + timedelta(minutes=10)
    assert sla.is_open_now(OFFICE, _at("2026-11-16T10:00:00+00:00"))
    assert not sla.is_open_now(OFFICE, _at("2026-11-15T10:00:00+00:00"))
    assert sla.is_open_now(None, friday_late)


def test_a_calendar_with_no_hours_never_loops_forever():
    closed = BusinessCalendar(name="Closed", timezone="Nowhere/Atlantis", hours={}, holidays=[])
    start = _at("2026-11-16T10:00:00+00:00")
    assert sla.add_business_minutes(closed, start, 60) == start + timedelta(minutes=60)


def test_matching_reads_customer_segment_category_and_channel():
    from types import SimpleNamespace

    from src.models.sla import SlaPolicy

    ticket = SimpleNamespace(customer_id="c1", category="BUG", channel="EMAIL")
    customer = SimpleNamespace(segment="ENTERPRISE")
    assert sla.matches(SlaPolicy(conditions={}), ticket, customer)
    assert sla.matches(SlaPolicy(conditions={"segments": ["ENTERPRISE"], "categories": ["BUG"]}), ticket, customer)
    assert not sla.matches(SlaPolicy(conditions={"segments": ["SMB"]}), ticket, customer)
    assert not sla.matches(SlaPolicy(conditions={"segments": ["SMB"]}), ticket, None)
    assert not sla.matches(SlaPolicy(conditions={"channels": ["PHONE"]}), ticket, customer)
    assert not sla.matches(SlaPolicy(conditions={"categories": ["BILLING"]}), ticket, customer)
    assert not sla.matches(SlaPolicy(conditions={"customer_ids": ["c2"]}), ticket, customer)


# ── Through the API ─────────────────────────────────────────────────────


@pytest.fixture()
def as_(monkeypatch):
    roles = {"admin": "administrator", "manager": "manager", "operator": "operator"}

    def claims(token):
        name = token.split("-", 1)[1]
        return persona_claims(name, roles[name], sid=f"sla-{name}")

    monkeypatch.setattr("src.core.auth.verify_token", claims)
    return lambda name: {"Authorization": f"Bearer sla-{name}"}


@pytest.fixture()
def restore_clocks():
    """Policies a test made are swept by the conftest; the tickets they touched
    are recomputed against what remains, so the demo's deadlines are its own."""
    yield
    from src.models.sla import SlaPolicy

    with session_scope() as session:
        for row in session.scalars(select(SlaPolicy).where(SlaPolicy.name.like("Test %"))).all():
            row.deleted_at = row.deleted_at or datetime.now(UTC)
        session.flush()
        sla.recompute_all(session)


def _open_ticket():
    from src.models.business import Ticket

    with session_scope() as session:
        ticket = session.scalars(select(Ticket).where(Ticket.deleted_at.is_(None), Ticket.status == "OPEN",
                                                      Ticket.category == "BUG",
                                                      Ticket.customer_id.is_not(None))).first()
        return str(ticket.id), ticket.priority, str(ticket.customer_id)


@pytest.mark.database
def test_a_policy_change_moves_a_tickets_deadline(client, as_, restore_clocks):
    ticket_id, priority, customer_id = _open_ticket()
    catalogue = client.get(f"{SLA}/catalogue", headers=as_("operator")).json
    assert "Europe/Berlin" in catalogue["timezones"] and catalogue["can_manage"] is False
    assert client.post(f"{SLA}/policies", json={"name": "Test x"}, headers=as_("operator")).status_code == 403

    calendar = client.post(f"{SLA}/calendars", json={
        "name": "Test office", "timezone": "Europe/Berlin",
        "hours": {day: [["09:00", "17:00"]] for day in ("mon", "tue", "wed", "thu", "fri")},
        "holidays": [{"date": "2026-12-25", "name": "Christmas"}]}, headers=as_("admin"))
    assert calendar.status_code == 201, calendar.json
    assert calendar.json["weekly_minutes"] == 5 * 8 * 60

    made = client.post(f"{SLA}/policies", json={
        "name": "Test bugs first", "conditions": {"categories": ["BUG"], "customer_ids": [customer_id]},
        "targets": {priority: {"first_response": 60, "resolution": 600}},
        "calendar_id": calendar.json["id"], "pause_statuses": ["WAITING_CUSTOMER"],
        "escalations": [{"at_percent": 80, "action": "NOTIFY", "target": "assignee"},
                        {"at_percent": 100, "action": "RAISE_PRIORITY"}]}, headers=as_("admin"))
    assert made.status_code == 201, made.json
    policy_id = made.json["id"]
    # Put it first so it wins.
    listed = client.get(f"{SLA}/policies", headers=as_("operator")).json
    ids = [item["id"] for item in listed["items"]]
    ordered = client.put(f"{SLA}/policies/order", json={"ids": [policy_id] + [i for i in ids if i != policy_id]},
                         headers=as_("admin"))
    assert ordered.status_code == 200
    assert ordered.json["items"][0]["id"] == policy_id

    clock = client.get(f"{SLA}/tickets/{ticket_id}", headers=as_("operator")).json
    assert clock["policy"]["name"] == "Test bugs first"
    assert clock["calendar"]["timezone"] == "Europe/Berlin"
    assert clock["targets"] == {"first_response": 60, "resolution": 600}
    first_due = clock["resolution"]["due_at"]
    assert [step["at_percent"] for step in clock["escalations"]] == [80, 100]

    # Tightening the target brings the deadline forward, on the ticket itself.
    client.put(f"{SLA}/policies/{policy_id}", json={"targets": {priority: {"first_response": 30, "resolution": 120}}},
               headers=as_("admin"))
    tighter = client.get(f"{SLA}/tickets/{ticket_id}", headers=as_("operator")).json
    assert tighter["resolution"]["due_at"] < first_due
    record = client.get(f"{PREFIX}/api/records/ticket/{ticket_id}", headers=as_("operator")).json
    due = next(field["value"] for field in record["fields"] if field["name"] == "due_at")
    assert due[:16] == tighter["resolution"]["due_at"][:16]

    assert client.get(f"{SLA}/policies/{policy_id}", headers=as_("operator")).json["name"] == "Test bugs first"
    # A calendar in use cannot be removed; the policy can.
    assert client.delete(f"{SLA}/calendars/{calendar.json['id']}", headers=as_("admin")).status_code == 400
    assert client.delete(f"{SLA}/policies/{policy_id}", headers=as_("admin")).json["removed"] is True
    assert client.delete(f"{SLA}/calendars/{calendar.json['id']}", headers=as_("admin")).json["removed"] is True
    after = client.get(f"{SLA}/tickets/{ticket_id}", headers=as_("operator")).json
    assert after["policy"] is None or after["policy"]["id"] != policy_id
    # With the test's policy gone, a full recompute and sweep is the demo's own.
    applied = client.post(f"{SLA}/apply", headers=as_("admin"))
    assert applied.status_code == 200 and applied.json["tickets"] > 0
    assert client.post(f"{SLA}/apply", headers=as_("operator")).status_code == 403


@pytest.mark.database
def test_waiting_on_the_customer_pauses_the_clock_and_escalations_fire_once(client, as_, restore_clocks):
    from src.models.business import Ticket
    from src.models.sla import TicketSla

    ticket_id, priority, customer_id = _open_ticket()
    made = client.post(f"{SLA}/policies", json={
        "name": "Test pause", "conditions": {"categories": ["BUG"], "customer_ids": [customer_id]},
        "targets": {priority: {"first_response": 1, "resolution": 2}},
        "pause_statuses": ["WAITING_CUSTOMER"],
        "escalations": [{"at_percent": 50, "action": "NOTIFY", "target": "manager"},
                        {"at_percent": 60, "action": "ASSIGN", "target": "assignee"},
                        {"at_percent": 100, "action": "RAISE_PRIORITY"}]}, headers=as_("admin")).json
    ids = [item["id"] for item in client.get(f"{SLA}/policies", headers=as_("admin")).json["items"]]
    client.put(f"{SLA}/policies/order", json={"ids": [made["id"]] + [i for i in ids if i != made["id"]]},
               headers=as_("admin"))

    from src.models.sla import SlaPolicy

    with session_scope() as session:
        # In force for a day, so a two-minute target is long gone.
        session.get(SlaPolicy, made["id"]).created_at = sla.now() - timedelta(days=1)
        session.flush()
        ticket = session.get(Ticket, ticket_id)
        original = (ticket.status, ticket.priority)
        state = sla.compute(session, ticket)
        assert state.policy_id is not None and ticket.sla_breached is True
        # Escalations fired on compute, once each.
        assert set(state.escalations_fired) == {0, 1, 2}
        assert sla._escalate(session, ticket, state, state.policy, sla.now()) == []

        ticket.status = "WAITING_CUSTOMER"
        state = sla.compute(session, ticket)
        assert state.paused_since is not None
        ticket.status = "OPEN"
        state = sla.compute(session, ticket)
        assert state.paused_since is None and state.paused_minutes >= 0
        ticket.status, ticket.priority = original
        session.flush()
        assert session.scalars(select(TicketSla).where(TicketSla.ticket_id == ticket.id)).first()

    client.delete(f"{SLA}/policies/{made['id']}", headers=as_("admin"))


@pytest.mark.database
@pytest.mark.parametrize("payload", [
    {"name": ""},
    {"name": "Test", "conditions": {"mood": ["x"]}},
    {"name": "Test", "conditions": {"segments": ["HUGE"]}},
    {"name": "Test", "conditions": "all"},
    {"name": "Test", "targets": {"URGENT": {"resolution": 5}}},
    {"name": "Test", "targets": {"HIGH": {"first_response": 90, "resolution": 30}}},
    {"name": "Test", "targets": {"HIGH": {"resolution": -3}}},
    {"name": "Test", "targets": {"HIGH": {"resolution": "soon"}}},
    {"name": "Test", "calendar_id": "11111111-1111-1111-1111-111111111111"},
    {"name": "Test", "pause_statuses": ["RESOLVED"]},
    {"name": "Test", "escalations": [{"at_percent": 50, "action": "PANIC"}]},
    {"name": "Test", "escalations": [{"at_percent": "half", "action": "NOTIFY"}]},
    {"name": "Test", "escalations": [{"at_percent": 0, "action": "NOTIFY"}]},
    {"name": "Test", "escalations": [{"at_percent": 50, "action": "NOTIFY", "target": "boss"}]},
])
def test_a_policy_that_cannot_work_is_refused(client, as_, payload):
    assert client.post(f"{SLA}/policies", json=payload, headers=as_("admin")).status_code == 400


@pytest.mark.database
@pytest.mark.parametrize("payload", [
    {"name": ""},
    {"name": "Test", "timezone": "Mars/Olympus", "hours": {"mon": [["09:00", "17:00"]]}},
    {"name": "Test", "hours": {}},
    {"name": "Test", "hours": {"mon": [["nine", "five"]]}},
    {"name": "Test", "hours": {"mon": [["17:00", "09:00"]]}},
    {"name": "Test", "hours": {"mon": [["09:00", "17:00"]]}, "holidays": [{"date": "someday"}]},
])
def test_a_calendar_that_cannot_work_is_refused(client, as_, payload):
    assert client.post(f"{SLA}/calendars", json=payload, headers=as_("admin")).status_code == 400


@pytest.mark.database
def test_reordering_needs_every_policy_and_unknown_ones_are_404(client, as_):
    assert client.put(f"{SLA}/policies/order", json={"ids": ["11111111-1111-1111-1111-111111111111"]},
                      headers=as_("admin")).status_code == 400
    missing = "11111111-1111-1111-1111-111111111111"
    assert client.get(f"{SLA}/policies/{missing}", headers=as_("admin")).status_code == 404
    assert client.put(f"{SLA}/calendars/{missing}", json={}, headers=as_("admin")).status_code == 404
    assert client.get(f"{SLA}/tickets/{missing}", headers=as_("admin")).status_code == 404
