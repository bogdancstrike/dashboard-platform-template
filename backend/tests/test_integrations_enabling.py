"""Connected systems (§26): what this platform talks to, and whether it works. — enabling."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from src.core.db import session_scope
from tests.integrations_support import (  # noqa: F401
    INTEGRATIONS,
    _any,
    _authenticate,
    _restore,
    _unconfigured,
    pytestmark,
)


def test_enabling_something_unconfigured_is_refused_with_the_settings(client, monkeypatch):
    """Switching on something that cannot possibly work produces a failure with
    no cause to find, and somebody then spends an afternoon on a token nobody
    entered."""
    headers = _authenticate(monkeypatch)
    row, original = _unconfigured(client, headers)
    try:
        answer = client.put(
            f"{INTEGRATIONS}/{row['id']}/enabled", headers=headers, json={"enabled": True}
        )
        assert answer.status_code == 400
        assert answer.get_json()["details"]["missing_settings"] == row["missing_settings"]
    finally:
        _restore(row["id"], original)


def test_enabling_a_configured_one_works(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    row = _any(client, headers, configured=True)

    answer = client.put(
        f"{INTEGRATIONS}/{row['id']}/enabled", headers=headers, json={"enabled": True}
    )
    assert answer.status_code == 200
    assert answer.get_json()["enabled"] is True


def test_turning_one_off_stops_it_claiming_to_be_connected(client, monkeypatch):
    """A stale CONNECTED on something switched off is a screen saying two
    contradictory things at once."""
    headers = _authenticate(monkeypatch)
    row = _any(client, headers, configured=True)
    client.put(f"{INTEGRATIONS}/{row['id']}/enabled", headers=headers, json={"enabled": True})

    body = client.put(
        f"{INTEGRATIONS}/{row['id']}/enabled", headers=headers, json={"enabled": False}
    ).get_json()
    assert body["enabled"] is False
    assert body["state"] != "CONNECTED"


def test_enabling_is_audited(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    row = _any(client, headers, configured=True)
    client.put(f"{INTEGRATIONS}/{row['id']}/enabled", headers=headers, json={"enabled": False})

    from src.models.platform import AuditLog

    with session_scope() as session:
        entry = session.scalar(
            select(AuditLog)
            .where(AuditLog.resource_type == "integration", AuditLog.resource_id == row["id"])
            .order_by(AuditLog.occurred_at.desc())
        )
    assert "disabled" in entry.message


def test_an_integration_cannot_be_invented_or_removed(client, monkeypatch):
    """The providers this platform can talk to come with the code. An operator
    extends the list by deploying, not by typing a name — so there is no
    endpoint that would let them believe otherwise."""
    headers = _authenticate(monkeypatch)
    row = _any(client, headers)

    assert client.post(INTEGRATIONS, headers=headers, json={"name": "Nope"}).status_code in (
        404,
        405,
    )
    assert client.delete(f"{INTEGRATIONS}/{row['id']}", headers=headers).status_code in (
        404,
        405,
    )


def test_one_that_does_not_exist_says_so(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    assert client.get(f"{INTEGRATIONS}/{uuid.uuid4()}", headers=headers).status_code == 404


def test_everything_here_needs_integrations_manage(client, monkeypatch):
    """The configuration names hosts and secret references, which is
    reconnaissance even where it is not a secret."""
    for username, role in (("manager", "manager"), ("user", "viewer"), ("analyst", "analyst")):
        headers = _authenticate(monkeypatch, username, role)
        assert client.get(INTEGRATIONS, headers=headers).status_code == 403, username
        assert (
            client.get(f"{INTEGRATIONS}/catalogue", headers=headers).status_code == 403
        ), username
