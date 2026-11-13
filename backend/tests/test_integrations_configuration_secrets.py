"""Connected systems (§26): what this platform talks to, and whether it works. — configuration and secrets."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from src.core.db import session_scope
from src.services.platform import integrations as service
from tests.integrations_support import (  # noqa: F401
    INTEGRATIONS,
    _any,
    _authenticate,
    _restore,
    _unconfigured,
    pytestmark,
)


def test_a_setting_named_like_a_secret_is_redacted(client, monkeypatch):
    """Matched on the *name*, not the value: a token is a string like any
    other, and guessing by shape would redact a base URL that looked like one
    while missing a short key that did not."""
    headers = _authenticate(monkeypatch)
    row = _any(client, headers, configured=True)
    detail = client.get(f"{INTEGRATIONS}/{row['id']}", headers=headers).get_json()

    assert "secret_ref" in detail["redacted_settings"]
    assert detail["configuration"]["secret_ref"] == service.REDACTED
    # And the ones that are not sensitive come through, or the screen would be
    # useless.
    assert detail["configuration"]["base_url"].startswith("https://")


def test_the_real_value_is_never_in_the_payload(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    row = _any(client, headers, configured=True)

    from src.models.platform import Integration

    with session_scope() as session:
        stored = session.scalar(
            select(Integration).where(Integration.id == uuid.UUID(row["id"]))
        )
        actual = str((stored.configuration or {}).get("secret_ref") or "")
    assert actual

    for path in (INTEGRATIONS, f"{INTEGRATIONS}/{row['id']}", f"{INTEGRATIONS}/catalogue"):
        body = client.get(path, headers=headers).get_data(as_text=True)
        assert actual not in body, path


def test_sending_the_redaction_back_leaves_the_value_alone(client, monkeypatch):
    """The trap this avoids: a form shows bullets, the operator saves an
    unrelated field, and the token becomes the bullets. Showing a masked value
    once would otherwise destroy it."""
    headers = _authenticate(monkeypatch)
    row = _any(client, headers, configured=True)

    from src.models.platform import Integration

    with session_scope() as session:
        stored = session.scalar(
            select(Integration).where(Integration.id == uuid.UUID(row["id"]))
        )
        original = dict(stored.configuration or {})
    before = original.get("secret_ref")

    try:
        client.put(
            f"{INTEGRATIONS}/{row['id']}",
            headers=headers,
            json={"configuration": {"secret_ref": service.REDACTED, "timeout_seconds": 45}},
        )

        with session_scope() as session:
            stored = session.scalar(
                select(Integration).where(Integration.id == uuid.UUID(row["id"]))
            )
            assert (stored.configuration or {}).get("secret_ref") == before
            assert (stored.configuration or {}).get("timeout_seconds") == 45
    finally:
        # Put the timeout back: the autouse cleanup deletes rows a test
        # *created* and cannot un-edit one it changed, so an edit left behind
        # is a demo that drifts a little further with every run.
        _restore(row["id"], original)


def test_clearing_a_setting_removes_it(client, monkeypatch):
    """An empty value means "unset this", which is how somebody takes an
    integration out of service without deleting it."""
    headers = _authenticate(monkeypatch)
    row, original = _unconfigured(client, headers)
    try:
        assert row["configured"] is False
        assert row["missing_settings"]
        assert row["state"] == "NOT_CONFIGURED"
    finally:
        _restore(row["id"], original)


def test_a_setting_name_that_is_not_a_name_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    row = _any(client, headers)

    answer = client.put(
        f"{INTEGRATIONS}/{row['id']}",
        headers=headers,
        json={"configuration": {"Not A Name": "x"}},
    )
    assert answer.status_code == 400
    assert answer.get_json()["details"]["invalid"] == ["Not A Name"]


def test_the_audit_row_carries_names_and_not_values(client, monkeypatch):
    """An audit trail holding the values would be the secret store nobody meant
    to build."""
    headers = _authenticate(monkeypatch)
    row = _any(client, headers)

    from src.models.platform import Integration

    with session_scope() as session:
        original = dict(
            (
                session.scalar(
                    select(Integration).where(Integration.id == uuid.UUID(row["id"]))
                ).configuration
                or {}
            )
        )

    client.put(
        f"{INTEGRATIONS}/{row['id']}",
        headers=headers,
        json={"configuration": {"secret_ref": "SUPER-SECRET-VALUE"}},
    )

    from src.models.platform import AuditLog

    with session_scope() as session:
        entry = session.scalar(
            select(AuditLog)
            .where(AuditLog.resource_type == "integration", AuditLog.resource_id == row["id"])
            .order_by(AuditLog.occurred_at.desc())
        )
    assert entry is not None
    assert "SUPER-SECRET-VALUE" not in repr(entry.state_after)
    assert "secret_ref" in repr(entry.state_after)
    _restore(row["id"], original)
