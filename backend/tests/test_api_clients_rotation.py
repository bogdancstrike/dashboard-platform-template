"""API clients and their credentials (§25): machines that call the platform. — rotation."""

from __future__ import annotations

import uuid
from datetime import timedelta

from src.core import vocabulary
from src.core.clock import now
from src.core.db import session_scope
from src.services.platform import api_clients as service
from tests.api_clients_support import (  # noqa: F401
    CLIENTS,
    CREDENTIALS,
    _authenticate,
    _make,
    pytestmark,
)


def test_rotation_mints_a_new_key_and_keeps_the_old_one_working(client, monkeypatch):
    """A rotation that killed the previous secret the instant a new one was
    minted is an outage with extra steps: every caller holding the old key
    fails until somebody redeploys them."""
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Rotating")
    original = made["credential"]

    answer = client.post(
        f"{CLIENTS}/{made['id']}/rotate",
        headers=headers,
        json={"credential_id": original["id"]},
    )
    assert answer.status_code == 201
    body = answer.get_json()

    assert body["secret"] != made["secret"]
    assert body["secret_shown_once"] is True
    assert body["credential"]["rotated_from_id"] == original["id"]
    # The old one still works, with a deadline.
    assert body["replaced"]["state"] == "ACTIVE"
    assert body["replaced"]["expires_at"] is not None
    assert body["grace_days"] == service.ROTATION_GRACE_DAYS


def test_rotation_never_extends_the_life_of_the_old_key(client, monkeypatch):
    """If it already expires sooner than the grace period, rotating must not
    push that out — otherwise rotating a nearly-dead key revives it."""
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Already dying")

    from src.models.platform import ApiCredential

    soon = now() + timedelta(days=1)
    with session_scope() as session:
        row = session.get(ApiCredential, uuid.UUID(made["credential"]["id"]))
        row.expires_at = soon

    client.post(
        f"{CLIENTS}/{made['id']}/rotate",
        headers=headers,
        json={"credential_id": made["credential"]["id"]},
    )

    with session_scope() as session:
        row = session.get(ApiCredential, uuid.UUID(made["credential"]["id"]))
        assert row.expires_at <= soon


def test_the_rotation_chain_is_recorded(client, monkeypatch):
    """"How old is the key this service is using" is a question with an answer
    only because each rotation points at the one before it."""
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Chained")

    first = made["credential"]["id"]
    second = client.post(
        f"{CLIENTS}/{made['id']}/rotate", headers=headers, json={"credential_id": first}
    ).get_json()["credential"]
    third = client.post(
        f"{CLIENTS}/{made['id']}/rotate",
        headers=headers,
        json={"credential_id": second["id"]},
    ).get_json()["credential"]

    assert second["rotated_from_id"] == first
    assert third["rotated_from_id"] == second["id"]


def test_rotating_a_revoked_credential_is_refused(client, monkeypatch):
    """There is nothing to rotate: it is already dead. Adding a fresh key is
    the thing somebody wants, and saying so is more use than a 500."""
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Revoked then rotated")
    client.delete(f"{CREDENTIALS}/{made['credential']['id']}", headers=headers)

    answer = client.post(
        f"{CLIENTS}/{made['id']}/rotate",
        headers=headers,
        json={"credential_id": made["credential"]["id"]},
    )
    assert answer.status_code == 409
    assert "nothing to rotate" in answer.get_json()["message"]


def test_a_credential_from_another_client_cannot_be_rotated(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    mine = _make(client, headers, name="Mine")
    theirs = _make(client, headers, name="Theirs")

    answer = client.post(
        f"{CLIENTS}/{mine['id']}/rotate",
        headers=headers,
        json={"credential_id": theirs["credential"]["id"]},
    )
    assert answer.status_code == 404


def test_revoking_keeps_the_row_and_records_who(client, monkeypatch):
    """The question after a leak is always when and by whom, and a row that
    vanished answers neither."""
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Leaked")

    answer = client.delete(f"{CREDENTIALS}/{made['credential']['id']}", headers=headers)
    assert answer.status_code == 200
    assert answer.get_json()["state"] == "REVOKED"
    assert answer.get_json()["revoked_at"] is not None

    from src.models.platform import ApiCredential

    with session_scope() as session:
        row = session.get(ApiCredential, uuid.UUID(made["credential"]["id"]))
        assert row is not None
        assert row.revoked_by_id is not None


def test_revoking_twice_is_refused(client, monkeypatch):
    """"Revoke" succeeding twice suggests the first one did not take."""
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Twice revoked")
    client.delete(f"{CREDENTIALS}/{made['credential']['id']}", headers=headers)

    answer = client.delete(f"{CREDENTIALS}/{made['credential']['id']}", headers=headers)
    assert answer.status_code == 409
    assert "already revoked" in answer.get_json()["message"]


def test_a_credentials_state_comes_from_its_dates():
    """`status` is a stored word and the dates are the facts: a key whose
    `expires_at` passed last Tuesday is expired whatever the column says."""

    class _Row:
        def __init__(self, revoked=None, expires=None):
            self.revoked_at = revoked
            self.expires_at = expires

    assert service.credential_state(_Row()) == "ACTIVE"
    assert service.credential_state(_Row(expires=now() + timedelta(days=1))) == "ACTIVE"
    assert service.credential_state(_Row(expires=now() - timedelta(days=1))) == "EXPIRED"
    assert service.credential_state(_Row(revoked=now())) == "REVOKED"
    # Revoked wins: a key revoked before it expired is revoked, not expired.
    assert (
        service.credential_state(_Row(revoked=now(), expires=now() - timedelta(days=9)))
        == "REVOKED"
    )
    assert set(vocabulary.API_CREDENTIAL_STATE) == {"ACTIVE", "EXPIRED", "REVOKED"}


def test_an_expired_credential_is_not_counted_as_live(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Expiring")

    from src.models.platform import ApiCredential

    with session_scope() as session:
        row = session.get(ApiCredential, uuid.UUID(made["credential"]["id"]))
        row.expires_at = now() - timedelta(minutes=1)

    detail = client.get(f"{CLIENTS}/{made['id']}", headers=headers).get_json()
    assert detail["credential_count"] == 1
    assert detail["live_credentials"] == 0
    assert detail["credentials"][0]["state"] == "EXPIRED"
