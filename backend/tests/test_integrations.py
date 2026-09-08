"""Connected systems (§26): what this platform talks to, and whether it works.

Two claims this module exists for.

**"Not configured" is derived, and so cannot be contradicted.** The seed used
to draw a status independently of the configuration and always wrote a complete
one — so three of twelve rows said `NOT_CONFIGURED` while holding every setting
they required, contradicting the single fact this page exists to establish.
`state()` computes it from `required_settings` against `configuration`, and
nothing reads the column for that purpose.

**A check says what it did not do.** Nothing here holds real provider
credentials, so the answer carries `reached_provider: false` and a sentence
saying so. A button reporting "Connected to Stripe" when no packet left the
process would be the worst possible lie on a screen whose whole job is to say
whether things work — and the test that matters is the one asserting the
platform does not claim it.

The rest: a secret is a reference and anything named like one is redacted;
sending the redaction back means "leave it alone", because a form that never
showed the real token would otherwise overwrite it with bullets; enabling is
refused while settings are missing, since switching on something that cannot
work produces a failure with no cause; and `enabled` is intent while `status` is
outcome, which makes "switched on and failing" a state that exists.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from src.config import Config
from src.core import vocabulary
from src.core.db import session_scope
from src.services import integrations as service
from tests.conftest import persona_claims

pytestmark = pytest.mark.database

PREFIX = Config.API_PREFIX
INTEGRATIONS = f"{PREFIX}/admin/integrations"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"int-{username}"),
    )
    return {"Authorization": f"Bearer int-{username}"}


def _any(client, headers, **wanted) -> dict:
    listing = client.get(f"{INTEGRATIONS}?page_size=100", headers=headers).get_json()
    assert listing["items"], "the seed has no integrations"
    for row in listing["items"]:
        if all(row.get(key) == value for key, value in wanted.items()):
            return row
    pytest.skip(f"no seeded integration matches {wanted}")


def _unconfigured(client, headers) -> tuple[dict, dict]:
    """An integration with a required setting cleared, and how to put it back.

    Made rather than found: these tests used to look for a seeded row that
    happened to be incomplete, and skipped on an installation whose rows were
    all complete — four tests quietly not running. Clearing a setting is the
    same act an operator performs, so the state is real rather than contrived.
    """
    row = _any(client, headers, configured=True)
    required = row["required_settings"]
    assert required, f"{row['name']} requires nothing, so it cannot be made incomplete"
    name = required[-1]

    from src.models.platform import Integration

    with session_scope() as session:
        stored = session.scalar(
            select(Integration).where(Integration.id == uuid.UUID(row["id"]))
        )
        original = dict(stored.configuration or {})

    answer = client.put(
        f"{INTEGRATIONS}/{row['id']}", headers=headers, json={"configuration": {name: ""}}
    )
    assert answer.status_code == 200, answer.get_json()
    return answer.get_json(), original


def _restore(row_id: str, configuration: dict) -> None:
    """Put a configuration back exactly, so the demo is what it was."""
    from src.models.platform import Integration

    with session_scope() as session:
        stored = session.scalar(
            select(Integration).where(Integration.id == uuid.UUID(row_id))
        )
        stored.configuration = configuration


class _Row:
    """The four fields `state` and `missing_settings` read, and nothing else."""

    def __init__(self, required=(), configuration=None, status="CONNECTED"):
        self.required_settings = list(required)
        self.configuration = dict(configuration or {})
        self.status = status


# ── "not configured" is derived ──────────────────────────────────────────


def test_a_missing_setting_makes_it_not_configured_whatever_the_column_says():
    """The defect this closes: the seed wrote `NOT_CONFIGURED` on rows holding
    every setting they required, and `CONNECTED` would have been just as
    possible the other way."""
    row = _Row(required=["base_url", "secret_ref"], configuration={"base_url": "x"},
               status="CONNECTED")
    assert service.missing_settings(row) == ["secret_ref"]
    assert service.state(row) == "NOT_CONFIGURED"


def test_a_blank_setting_counts_as_missing():
    """A `secret_ref` set to "" is one somebody started and abandoned. Treating
    it as present is how a check passes for something that cannot work."""
    for value in ("", "   ", None):
        row = _Row(required=["secret_ref"], configuration={"secret_ref": value})
        assert service.missing_settings(row) == ["secret_ref"], repr(value)


def test_a_complete_configuration_leaves_the_status_alone():
    """The status is a genuine record of the last attempt, so once the settings
    are there it stands."""
    complete = {"base_url": "https://x", "secret_ref": "TOKEN"}
    for status in ("CONNECTED", "DISCONNECTED", "ERROR"):
        row = _Row(required=list(complete), configuration=complete, status=status)
        assert service.state(row) == status


def test_a_stale_not_configured_becomes_disconnected():
    """An older row whose settings have since been filled in has not been tried
    since — which is exactly what DISCONNECTED means, and is better than
    reporting a state the data contradicts."""
    complete = {"base_url": "https://x", "secret_ref": "TOKEN"}
    row = _Row(required=list(complete), configuration=complete, status="NOT_CONFIGURED")
    assert service.state(row) == "DISCONNECTED"


def test_no_seeded_row_contradicts_its_own_configuration(client, monkeypatch):
    """Asserted of the *database*, which is what an installation actually has.

    This is the check that would have caught the original defect: three of
    twelve rows saying `NOT_CONFIGURED` with nothing missing.
    """
    headers = _authenticate(monkeypatch)
    listing = client.get(f"{INTEGRATIONS}?page_size=100", headers=headers).get_json()

    wrong = [
        row["name"]
        for row in listing["items"]
        if (row["state"] == "NOT_CONFIGURED") != (len(row["missing_settings"]) > 0)
    ]
    assert not wrong, wrong


def test_the_state_counts_agree_with_the_rows(client, monkeypatch):
    """Counted on the derived state, so the chips cannot disagree with the
    table underneath them (§71)."""
    headers = _authenticate(monkeypatch)
    catalogue = client.get(f"{INTEGRATIONS}/catalogue", headers=headers).get_json()
    listing = client.get(f"{INTEGRATIONS}?page_size=100", headers=headers).get_json()

    from collections import Counter

    actual = Counter(row["state"] for row in listing["items"])
    for entry in catalogue["states"]:
        assert entry["count"] == actual.get(entry["key"], 0), entry["key"]


def test_the_categories_in_the_database_are_all_declared(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    listing = client.get(f"{INTEGRATIONS}?page_size=100", headers=headers).get_json()
    categories = {row["category"] for row in listing["items"]}
    assert categories <= set(vocabulary.INTEGRATION_CATEGORY)


# ── intent and outcome are different ─────────────────────────────────────


def test_the_seed_produces_something_switched_on_and_failing():
    """The row this page exists for.

    Asserted about the *generator* rather than the database: an installation
    seeded before this was fixed still holds the old rows, and the claim is
    about what the seed produces. The first version set `enabled` from the
    status, so an integration somebody switched on that is now erroring could
    never occur — and that is exactly what an operator opens this screen to
    find.
    """
    from src.seed import runner
    from src.seed.world import SCALES

    world = runner.generate(scale=SCALES["small"], seed=20240601)
    failing = [row for row in world.integrations if row.enabled and row.status == "ERROR"]
    assert failing, "no seeded integration is switched on and failing"


def test_the_seed_never_contradicts_its_own_configuration():
    """Where the original defect lived: a status drawn independently of the
    settings, on rows that always had a complete configuration."""
    from src.seed import runner
    from src.seed.world import SCALES

    world = runner.generate(scale=SCALES["small"], seed=20240601)
    for row in world.integrations:
        incomplete = not set(row.required_settings or []) <= set((row.configuration or {}).keys())
        assert (row.status == "NOT_CONFIGURED") == incomplete, row.name


def test_enabled_and_state_are_reported_separately(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    listing = client.get(f"{INTEGRATIONS}?page_size=100", headers=headers).get_json()
    for row in listing["items"]:
        assert isinstance(row["enabled"], bool)
        assert row["state"] in vocabulary.INTEGRATION_STATUS


# ── the check ────────────────────────────────────────────────────────────


def test_a_check_says_it_did_not_reach_the_provider(client, monkeypatch):
    """The claim worth asserting most. Reporting a connection nothing attempted
    would be the worst lie available on this screen."""
    headers = _authenticate(monkeypatch)
    row = _any(client, headers, configured=True)

    answer = client.post(f"{INTEGRATIONS}/{row['id']}/check", headers=headers)
    assert answer.status_code == 200
    body = answer.get_json()
    assert body["reached_provider"] is False
    assert body["configured"] is True
    # And says where to make it real, rather than leaving somebody to wonder
    # why a green tick means nothing.
    assert "does not contact" in body["note"]


def test_a_check_on_an_incomplete_one_names_the_settings(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    row, original = _unconfigured(client, headers)
    try:
        body = client.post(f"{INTEGRATIONS}/{row['id']}/check", headers=headers).get_json()
        assert body["configured"] is False
        assert body["missing_settings"]
        assert body["missing_settings"][0] in body["note"]
    finally:
        _restore(row["id"], original)


def test_a_failed_check_is_recorded_as_a_check(client, monkeypatch):
    """Worded so nobody mistakes it for the provider's own message — an
    operator reading "401 from the provider" that the platform invented would
    chase the wrong thing entirely."""
    headers = _authenticate(monkeypatch)
    row, original = _unconfigured(client, headers)
    try:
        client.post(f"{INTEGRATIONS}/{row['id']}/check", headers=headers)
        detail = client.get(f"{INTEGRATIONS}/{row['id']}", headers=headers).get_json()
        assert detail["last_error"].startswith("Configuration check:")
    finally:
        _restore(row["id"], original)


def test_a_passing_check_clears_a_previous_error(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    row, original = _unconfigured(client, headers)
    try:
        client.post(f"{INTEGRATIONS}/{row['id']}/check", headers=headers)
        client.put(
            f"{INTEGRATIONS}/{row['id']}",
            headers=headers,
            json={"configuration": {name: "filled-in" for name in row["missing_settings"]}},
        )
        body = client.post(f"{INTEGRATIONS}/{row['id']}/check", headers=headers).get_json()

        assert body["configured"] is True
        detail = client.get(f"{INTEGRATIONS}/{row['id']}", headers=headers).get_json()
        assert detail["last_error"] is None
    finally:
        _restore(row["id"], original)


# ── configuration and secrets ────────────────────────────────────────────


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


# ── enabling ─────────────────────────────────────────────────────────────


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


# ── there is no create and no delete ─────────────────────────────────────


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


# ── permissions ──────────────────────────────────────────────────────────


def test_everything_here_needs_integrations_manage(client, monkeypatch):
    """The configuration names hosts and secret references, which is
    reconnaissance even where it is not a secret."""
    for username, role in (("manager", "manager"), ("user", "viewer"), ("analyst", "analyst")):
        headers = _authenticate(monkeypatch, username, role)
        assert client.get(INTEGRATIONS, headers=headers).status_code == 403, username
        assert (
            client.get(f"{INTEGRATIONS}/catalogue", headers=headers).status_code == 403
        ), username
