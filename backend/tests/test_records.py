"""Entity record detail (§8).

One declaration per entity has to yield the list *and* the detail, or the two
drift: a field filterable on the list that the detail page has never heard of
is how a "complete" record view ends up missing the column somebody added last
month. So what is asserted here is mostly agreement — that the detail carries
exactly what the catalogue declares.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select

from src.config import Config

PREFIX = Config.API_PREFIX


def _claims(username: str, role: str) -> dict:
    return {
        "sub": "", "email": f"{username}@nucleus.example",
        "preferred_username": username, "name": username.title(),
        "sid": f"records-{username}", "realm_access": {"roles": [role]},
    }


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr("src.core.auth.verify_token", lambda _token: _claims(username, role))
    return {"Authorization": f"Bearer records-{username}"}


def _a_ticket():
    from src.core.db import session_scope
    from src.models.business import Ticket

    with session_scope() as session:
        return session.scalars(
            select(Ticket).where(Ticket.deleted_at.is_(None)).limit(1)
        ).one()


def test_a_record_needs_a_bearer_token(client):
    assert client.get(f"{PREFIX}/api/records/ticket/{uuid4()}").status_code == 401


@pytest.mark.database
def test_a_record_carries_every_field_its_declaration_publishes(client, monkeypatch):
    ticket = _a_ticket()
    headers = _authenticate(monkeypatch)

    body = client.get(f"{PREFIX}/api/records/ticket/{ticket.id}", headers=headers).get_json()
    catalogue = client.get(f"{PREFIX}/api/explorer/catalog", headers=headers).get_json()
    declared = next(item for item in catalogue["items"] if item["key"] == "ticket")

    # The detail and the list read one declaration, so their field sets agree
    # by construction rather than by anybody remembering to update both.
    assert {field["name"] for field in body["fields"]} == {
        field["name"] for field in declared["fields"]
    }
    assert body["id"] == str(ticket.id)
    assert body["resource_type"] == "ticket"
    assert body["path"] == "/tickets"


@pytest.mark.database
def test_a_record_says_what_to_call_it_rather_than_leaving_a_uuid(client, monkeypatch):
    ticket = _a_ticket()

    body = client.get(
        f"{PREFIX}/api/records/ticket/{ticket.id}", headers=_authenticate(monkeypatch)
    ).get_json()

    # A heading reading "a1f3c8de-…" is a heading nobody can use.
    assert body["title"] == ticket.subject
    assert body["subtitle"] == ticket.reference
    assert body["status"] == ticket.status


@pytest.mark.database
def test_field_values_are_serialised_for_a_reader(client, monkeypatch):
    ticket = _a_ticket()

    body = client.get(
        f"{PREFIX}/api/records/ticket/{ticket.id}", headers=_authenticate(monkeypatch)
    ).get_json()
    by_name = {field["name"]: field for field in body["fields"]}

    # Dates as ISO strings, UUIDs as strings, labels and kinds alongside — the
    # page renders what it is given rather than reimplementing the catalogue.
    assert isinstance(by_name["created_at"]["value"], str)
    assert by_name["created_at"]["kind"] == "datetime"
    assert by_name["sla_breached"]["kind"] == "bool"
    assert by_name["assignee_id"]["label"] == "Assignee ID"


@pytest.mark.database
def test_an_unknown_entity_and_a_missing_record_are_both_client_errors(client, monkeypatch):
    headers = _authenticate(monkeypatch)

    unknown_kind = client.get(f"{PREFIX}/api/records/secrets/{uuid4()}", headers=headers)
    missing = client.get(f"{PREFIX}/api/records/ticket/{uuid4()}", headers=headers)

    assert unknown_kind.status_code == 400
    assert "ticket" in unknown_kind.get_json()["details"]["available"]
    assert missing.status_code == 404


@pytest.mark.database
def test_a_record_of_the_wrong_type_is_not_found_rather_than_returned(client, monkeypatch):
    # An id is not a capability: asking for a ticket's id under /customers must
    # not hand back the ticket, and must not confirm that the id exists either.
    ticket = _a_ticket()

    response = client.get(
        f"{PREFIX}/api/records/customer/{ticket.id}", headers=_authenticate(monkeypatch)
    )

    assert response.status_code == 404


@pytest.mark.database
def test_reading_a_record_requires_the_permission_the_entity_declares(client, monkeypatch):
    ticket = _a_ticket()
    _authenticate(monkeypatch, "user", "viewer")
    monkeypatch.setattr("src.core.auth._permissions_for", lambda *_args: set())

    response = client.get(
        f"{PREFIX}/api/records/ticket/{ticket.id}",
        headers={"Authorization": "Bearer verified-but-unprivileged"},
    )

    assert response.status_code == 403
    assert response.get_json()["details"]["missing"] == ["records.view"]
