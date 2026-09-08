"""API clients and their credentials (§25): machines that call the platform.

Two claims this module exists for.

**A secret is shown once, and that is a property rather than a policy.** Only
the hash is stored, so there is nothing to show a second time — which means the
test worth writing is not "the second request is refused" but *no response
anywhere carries the plaintext again*, and no stored column contains it.

**A client cannot be scoped beyond what its creator holds.** Scopes come from
the permission catalogue, so granting one to a machine is granting a permission.
Without the ceiling, `api.manage` would be worth everything in the catalogue —
the same escalation `/admin/groups` had to close.

The rest: rotation issues a *new* credential and gives the old one a deadline,
because killing it immediately is an outage with extra steps; a revoked
credential is kept, since the question after a leak is always when and by whom;
a credential's state comes from its dates and not its column; and retiring a
client revokes its keys, or a consumer nothing lists any more could still call.
"""

from __future__ import annotations

import re
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from src.config import Config
from src.core import vocabulary
from src.core.clock import now
from src.core.db import session_scope
from src.services import api_clients as service
from tests.conftest import persona_claims

pytestmark = pytest.mark.database

PREFIX = Config.API_PREFIX
CLIENTS = f"{PREFIX}/admin/api-clients"
CREDENTIALS = f"{PREFIX}/admin/api-credentials"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"api-{username}"),
    )
    return {"Authorization": f"Bearer api-{username}"}


def _make(client, headers, **extra) -> dict:
    body = {"name": extra.pop("name", f"Test client {uuid.uuid4().hex[:6]}"), **extra}
    answer = client.post(CLIENTS, headers=headers, json=body)
    assert answer.status_code == 201, answer.get_json()
    return answer.get_json()


# ── the secret is shown once ─────────────────────────────────────────────


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


# ── the scope ceiling ────────────────────────────────────────────────────


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


# ── rotation ─────────────────────────────────────────────────────────────


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


# ── revocation ───────────────────────────────────────────────────────────


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


# ── retiring a client ────────────────────────────────────────────────────


def test_retiring_a_client_revokes_its_keys(client, monkeypatch):
    """A soft-deleted client whose credentials stayed live would be a consumer
    nothing lists any more, still able to call — the same shape of bug a
    retired group had."""
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Retired with keys")
    client.post(
        f"{CLIENTS}/{made['id']}/rotate", headers=headers, json={}
    )  # a second live key

    answer = client.delete(f"{CLIENTS}/{made['id']}", headers=headers)
    assert answer.status_code == 200
    assert answer.get_json()["credentials_revoked"] == 2

    from src.models.platform import ApiCredential

    with session_scope() as session:
        rows = session.scalars(
            select(ApiCredential).where(ApiCredential.api_client_id == uuid.UUID(made["id"]))
        ).all()
        assert rows
        assert all(row.revoked_at is not None for row in rows)


def test_a_retired_client_is_gone_from_the_listing(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Gone")
    client.delete(f"{CLIENTS}/{made['id']}", headers=headers)

    listing = client.get(f"{CLIENTS}?page_size=100", headers=headers).get_json()
    assert made["id"] not in {row["id"] for row in listing["items"]}
    assert client.get(f"{CLIENTS}/{made['id']}", headers=headers).status_code == 404


# ── the two windows of numbers ───────────────────────────────────────────


def test_the_lifetime_counter_and_the_recent_window_are_separate(client, monkeypatch):
    """Three point seven million requests against twelve logged rows is not a
    contradiction — one is a lifetime counter the gateway keeps and the other
    is a recent window. A screen that merged them would read as one answer to
    two different questions (§71)."""
    headers = _authenticate(monkeypatch)
    listing = client.get(f"{CLIENTS}?page_size=5", headers=headers).get_json()
    seeded = next((row for row in listing["items"] if row["requests_total"] > 0), None)
    if seeded is None:
        pytest.skip("no seeded client has traffic")

    detail = client.get(f"{CLIENTS}/{seeded['id']}", headers=headers).get_json()
    # Both present, and named differently.
    assert detail["requests_total"] >= 0
    assert detail["recent_window"] == len(detail["recent_requests"])
    assert detail["recent_failures"] <= detail["recent_window"]
    assert detail["recent_window"] <= service.MAX_REQUESTS


def test_limits_are_bounded(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.post(
        CLIENTS, headers=headers, json={"name": "Silly limit", "rate_limit_per_minute": 0}
    )
    assert answer.status_code == 400
    assert answer.get_json()["details"]["minimum"] == 1


def test_a_status_outside_the_vocabulary_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Odd status")
    answer = client.put(f"{CLIENTS}/{made['id']}", headers=headers, json={"status": "PAUSED"})
    assert answer.status_code == 400
    assert answer.get_json()["details"]["allowed"] == list(vocabulary.API_CLIENT_STATUS)


# ── auditing ─────────────────────────────────────────────────────────────


def test_the_audit_row_names_the_scopes_that_were_granted(client, monkeypatch):
    """"created an API client" without the scopes is an entry that does not
    record what was granted."""
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Audited", scopes=["audit.view"])

    from src.models.platform import AuditLog

    with session_scope() as session:
        row = session.scalar(
            select(AuditLog)
            .where(AuditLog.resource_type == "api_client", AuditLog.resource_id == made["id"])
            .order_by(AuditLog.occurred_at.desc())
        )
    assert row is not None
    assert "audit.view" in row.message


def test_a_scope_change_is_named_in_the_audit(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    made = _make(client, headers, name="Scope moved", scopes=["audit.view"])
    client.put(
        f"{CLIENTS}/{made['id']}", headers=headers, json={"scopes": ["records.view"]}
    )

    from src.models.platform import AuditLog

    with session_scope() as session:
        row = session.scalar(
            select(AuditLog)
            .where(AuditLog.resource_type == "api_client", AuditLog.resource_id == made["id"])
            .order_by(AuditLog.occurred_at.desc())
        )
    assert "+records.view" in row.message
    assert "-audit.view" in row.message


# ── permissions ──────────────────────────────────────────────────────────


def test_everything_here_needs_api_manage(client, monkeypatch):
    """Reading is not a lesser privilege: a client's scopes and its allowed
    addresses are exactly what somebody would want before attacking it."""
    for username, role in (("manager", "manager"), ("user", "viewer"), ("analyst", "analyst")):
        headers = _authenticate(monkeypatch, username, role)
        assert client.get(CLIENTS, headers=headers).status_code == 403, username
        assert client.get(f"{CLIENTS}/catalogue", headers=headers).status_code == 403, username
        assert (
            client.post(CLIENTS, headers=headers, json={"name": "Nope"}).status_code == 403
        ), username
