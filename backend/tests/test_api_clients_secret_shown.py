"""API clients and their credentials (§25): machines that call the platform. — the secret is shown once."""

from __future__ import annotations

import re
import uuid

import pytest
from sqlalchemy import select

from src.core.db import session_scope
from src.services.platform import api_clients as service
from tests.api_clients_support import (  # noqa: F401
    CLIENTS,
    _authenticate,
    _make,
    pytestmark,
)


def test_creation_returns_the_secret_and_says_it_is_the_only_time(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Shown once")

    assert made["secret"].startswith(service.SECRET_PREFIX)
    assert len(made["secret"]) > 30
    # Said in the payload rather than left for somebody to discover.
    assert made["secret_shown_once"] is True
    # And the prefix is the only part that is ever shown again: enough to tell
    # two keys apart in a log line, not enough to use.
    assert made["secret"].startswith(made["credential"]["prefix"])


def test_the_plaintext_is_nowhere_in_the_database(client, monkeypatch):
    """The property the whole design rests on. Not "the API refuses to send it"
    — there is nothing to send."""
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Nothing stored")
    secret = made["secret"]

    from src.models.platform import ApiClient, ApiCredential

    with session_scope() as session:
        credential = session.scalar(
            select(ApiCredential).where(
                ApiCredential.id == uuid.UUID(made["credential"]["id"])
            )
        )
        assert credential is not None
        assert secret not in credential.secret_hash
        assert credential.secret_hash.startswith("sha256$")
        # And the client row holds nothing of it either.
        row = session.scalar(select(ApiClient).where(ApiClient.id == uuid.UUID(made["id"])))
        assert secret not in repr(row.__dict__)


def test_no_later_response_carries_the_secret(client, monkeypatch):
    """Every endpoint that returns this credential, asked in turn."""
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Never again")
    secret = made["secret"]

    for path in (CLIENTS, f"{CLIENTS}/{made['id']}", f"{CLIENTS}/catalogue"):
        body = client.get(path, headers=headers).get_data(as_text=True)
        assert secret not in body, path


def test_two_secrets_are_never_the_same(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    first = _make(client, headers, name="Entropy one")
    second = _make(client, headers, name="Entropy two")
    assert first["secret"] != second["secret"]
    assert first["credential"]["prefix"] != second["credential"]["prefix"]


def test_the_secret_is_greppable(client, monkeypatch):
    """A recognisable prefix is worth more than the entropy those characters
    would have added: it makes a leaked key findable in a log or on a paste
    site."""
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Greppable")
    assert re.match(r"^nuc_[A-Za-z0-9_\-]{20,}$", made["secret"])


def test_a_client_cannot_be_scoped_beyond_its_creator(client, monkeypatch):
    """The escalation this closes: scopes are permissions, so `api.manage`
    would otherwise be worth every one of them.

    Asserted with a *synthetic* caller who holds `api.manage` and little else,
    because only ADMINISTRATOR holds it today — and the rule exists precisely
    so that stays safe if a narrower role ever gets it.
    """
    from src.core.auth import Principal

    narrow = Principal(
        user_id=uuid.uuid4(),
        subject="s",
        email="n@nucleus.local",
        username="narrow",
        full_name="Narrow Caller",
        role_code="CUSTOM",
        permissions=frozenset({"api.manage", "records.view"}),
    )

    # What they hold is fine…
    assert service._checked_scopes(["records.view"], principal=narrow) == ["records.view"]

    # …and what they do not is refused, naming exactly what was beyond them.
    with pytest.raises(Exception) as raised:
        service._checked_scopes(["records.view", "roles.manage"], principal=narrow)
    assert "roles.manage" in str(raised.value)
    assert raised.value.details["beyond_your_own"] == ["roles.manage"]


def test_an_administrator_may_grant_anything_they_hold(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Broad scopes", scopes=["records.view", "audit.view"])
    assert made["scopes"] == ["audit.view", "records.view"]


def test_a_scope_no_endpoint_checks_for_is_refused(client, monkeypatch):
    """A typo would silently grant nothing and look exactly like a scope that
    works — the same defect a group granting `records.expport` had."""
    headers = _authenticate(monkeypatch)
    answer = client.post(
        CLIENTS, headers=headers, json={"name": "Typo scope", "scopes": ["records.expport"]}
    )
    assert answer.status_code == 400
    assert answer.get_json()["details"]["unknown"] == ["records.expport"]


def test_the_catalogue_offers_only_what_the_caller_may_grant(client, monkeypatch):
    """Offering the whole catalogue and refusing half of it on save would be a
    form that produces an error on purpose."""
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{CLIENTS}/catalogue", headers=headers).get_json()
    # An administrator holds everything, so nothing is withheld — and the
    # field is present either way so the page can say so.
    assert answer["withheld_scopes"] == []
    assert len(answer["scopes"]) > 10
    assert all(item["label"] for item in answer["scopes"])


def test_editing_scopes_is_bounded_the_same_way(client, monkeypatch):
    """The ceiling has to be on the *edit* too, or it is a ceiling somebody
    steps over on their second request."""
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Edited scopes")

    answer = client.put(
        f"{CLIENTS}/{made['id']}", headers=headers, json={"scopes": ["not.a.permission"]}
    )
    assert answer.status_code == 400
