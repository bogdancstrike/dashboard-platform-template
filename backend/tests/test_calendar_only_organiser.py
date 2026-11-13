"""The calendar (§19). — only organiser."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.core.db import session_scope
from src.services.work import calendar as service
from tests.calendar_support import (  # noqa: F401
    EVENTS,
    _authenticate,
)


@pytest.mark.database
def test_only_the_organiser_changes_an_event(client, monkeypatch):
    """It sits in other people's weeks, so "anybody who may write to the
    calendar may rewrite yours" is the wrong default."""
    as_manager = _authenticate(monkeypatch, "manager", "manager")
    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — ownership",
            "starts_at": "2027-05-11T09:00:00+00:00",
            "ends_at": "2027-05-11T10:00:00+00:00",
        },
        headers=as_manager,
    ).get_json()
    assert created["can_edit"] is True

    as_operator = _authenticate(monkeypatch, "operator", "operator")
    seen = client.get(f"{EVENTS}/{created['id']}", headers=as_operator).get_json()
    # Readable, and the server says the control should not be offered (§76).
    assert seen["can_edit"] is False
    assert client.put(
        f"{EVENTS}/{created['id']}", json={"title": "Mine now"}, headers=as_operator
    ).status_code == 403


@pytest.mark.database
def test_an_administrator_can_cancel_a_meeting_whose_organiser_has_left(client, monkeypatch):
    as_manager = _authenticate(monkeypatch, "manager", "manager")
    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — admin cancels",
            "starts_at": "2027-05-12T09:00:00+00:00",
            "ends_at": "2027-05-12T10:00:00+00:00",
        },
        headers=as_manager,
    ).get_json()

    admin = _authenticate(monkeypatch, "admin", "administrator")
    assert client.delete(f"{EVENTS}/{created['id']}", headers=admin).status_code == 200


@pytest.mark.database
def test_cancelling_an_event_says_so_as_well_as_removing_it(client, monkeypatch):
    """Two different questions: the row stays for the audit trail, and anything
    still reading the event sees that it is not happening."""
    headers = _authenticate(monkeypatch)
    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — cancelled",
            "starts_at": "2027-05-13T09:00:00+00:00",
            "ends_at": "2027-05-13T10:00:00+00:00",
        },
        headers=headers,
    ).get_json()

    assert client.delete(f"{EVENTS}/{created['id']}", headers=headers).status_code == 200

    from src.models.business import CalendarEvent

    with session_scope() as session:
        row = session.get(CalendarEvent, created["id"])
        assert row.deleted_at is not None
        assert row.status == "CANCELLED"

    assert client.get(f"{EVENTS}/{created['id']}", headers=headers).status_code == 404


@pytest.mark.database
def test_the_window_can_be_narrowed_to_what_involves_me(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    everything = client.get(
        f"{EVENTS}?from=2026-08-01&to=2026-10-01", headers=headers
    ).get_json()
    mine = client.get(
        f"{EVENTS}?from=2026-08-01&to=2026-10-01&mine=1", headers=headers
    ).get_json()

    assert mine["total"] <= everything["total"]
    assert all(item["involves_me"] for item in mine["items"])


@pytest.mark.database
def test_a_category_that_does_not_exist_is_named_rather_than_ignored(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.get(
        f"{EVENTS}?from=2026-08-01&to=2026-09-01&category=PARTY", headers=headers
    )
    assert response.status_code == 400
    assert "MEETING" in response.get_json()["details"]["allowed"]


@pytest.mark.database
def test_editing_a_series_is_audited_and_says_it_changed_the_series(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — audited",
            "starts_at": "2027-05-14T09:00:00+00:00",
            "ends_at": "2027-05-14T10:00:00+00:00",
            "location": "Room Aurora (4)",
        },
        headers=headers,
    ).get_json()

    client.put(
        f"{EVENTS}/{created['id']}", json={"location": "Room Basalt (8)"}, headers=headers
    )

    from src.models.platform import AuditLog

    with session_scope() as session:
        entry = session.scalars(
            select(AuditLog)
            .where(
                AuditLog.resource_type == "calendar_event",
                AuditLog.resource_id == created["id"],
                AuditLog.action == "calendar.update",
            )
            .order_by(AuditLog.occurred_at.desc())
        ).first()
    assert entry is not None
    assert entry.state_before["location"] == "Room Aurora (4)"
    assert entry.state_after["location"] == "Room Basalt (8)"


@pytest.mark.database
def test_an_occurrence_id_is_accepted_wherever_an_event_id_is(client, monkeypatch):
    """The grid hands back the id it was given, and making every call site
    remember to split on the colon is a bug waiting for the one that forgets."""
    headers = _authenticate(monkeypatch)
    created = client.post(
        EVENTS,
        json={
            "title": "Calendar test — occurrence id",
            "starts_at": "2027-05-17T09:00:00+00:00",
            "ends_at": "2027-05-17T09:30:00+00:00",
            "recurrence": {"freq": "WEEKLY", "interval": 1, "byday": ["MO"]},
            "recurrence_until": "2027-06-30T00:00:00+00:00",
        },
        headers=headers,
    ).get_json()

    answer = client.get(f"{EVENTS}?from=2027-05-01&to=2027-06-01", headers=headers).get_json()
    occurrence = next(
        item for item in answer["items"] if item["title"] == "Calendar test — occurrence id"
    )
    assert ":" in occurrence["id"]

    # `_event` resolves it to the series it belongs to.
    with session_scope() as session:
        row = service._event(session, occurrence["id"])
    assert str(row.id) == created["id"]
