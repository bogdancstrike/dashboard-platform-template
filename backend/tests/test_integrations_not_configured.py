"""Connected systems (§26): what this platform talks to, and whether it works. — "not configured" is derived."""

from __future__ import annotations

from src.core import vocabulary
from src.services.platform import integrations as service
from tests.integrations_support import (  # noqa: F401
    INTEGRATIONS,
    _any,
    _authenticate,
    _restore,
    _Row,
    _unconfigured,
    pytestmark,
)


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
