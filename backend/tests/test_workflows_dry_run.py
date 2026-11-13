"""Condition → action automation (§49). — Dry run."""

from __future__ import annotations

from sqlalchemy import select

from src.core.db import session_scope
from src.services.automation import workflows as service
from tests.workflows_support import (  # noqa: F401
    RULES,
    _authenticate,
    _mine,
    _rule,
    _run,
    pytestmark,
)


def test_a_dry_run_reports_what_would_happen_and_changes_nothing(
    client, monkeypatch):
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers)

    from src.models.platform import AlertRuleFire

    with session_scope() as session:
        before = len(session.scalars(_mine(rule["id"])).all())

    answer = _run(client, headers, rule["id"], dry_run=True)

    assert answer["dry_run"] is True
    assert answer["matched"] > 0, "the seed has tasks in NEW"
    # Everything matched is either acted on or deferred — never dropped.
    # Asserting `fired == matched` was only true while the table was smaller
    # than one run's fire budget, which is a test that passes for a reason
    # that has nothing to do with the claim.
    assert answer["fired"] + answer["deferred"] == answer["matched"]
    assert answer["fired"] == min(answer["matched"], service.MAX_FIRES)
    assert {item["state"] for item in answer["sample"]} == {"WOULD FIRE"}

    with session_scope() as session:
        # No cooldown started, so the real run that follows is not suppressed
        # by the rehearsal — the single most confusing thing a dry run could do.
        assert session.scalars(
            select(AlertRuleFire).where(AlertRuleFire.rule_id == rule["id"])
        ).first() is None
        assert len(session.scalars(_mine(rule["id"])).all()) == before == 0


def test_a_paused_rule_may_be_rehearsed_but_not_fired(client, monkeypatch):
    """Reading what it *would* do is how somebody decides to enable it."""
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, enabled=False)

    assert _run(client, headers, rule["id"], dry_run=True)["matched"] >= 0

    response = client.post(
        f"{RULES}/{rule['id']}/run", json={"dry_run": False}, headers=headers
    )
    assert response.status_code == 400
    assert "paused" in response.get_json()["message"]


def test_the_dry_run_and_the_real_run_agree_on_the_matches(client, monkeypatch):
    """One evaluator, or the preview can disagree with the thing it previews."""
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, cooldown_minutes=0)

    rehearsal = _run(client, headers, rule["id"], dry_run=True)
    real = _run(client, headers, rule["id"], dry_run=False)
    assert real["matched"] == rehearsal["matched"]
    assert real["fired"] == rehearsal["fired"]


def test_firing_notifies_and_records_the_run(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers)

    answer = _run(client, headers, rule["id"], dry_run=False)
    assert answer["fired"] > 0
    assert {item["state"] for item in answer["sample"]} == {"FIRED"}
    assert answer["by_action"]["NOTIFY"]["ok"] > 0

    with session_scope() as session:
        written = session.scalars(_mine(rule["id"])).all()
    assert written, "the notify action wrote nothing"
    # The notification is actionable: it says where the record is (§66).
    assert all(item.link and item.link.startswith("/tasks/") for item in written)


def test_the_cooldown_is_held_per_record_and_not_per_rule(client, monkeypatch):
    """The difference between the requirement and a thing that looks like it.

    A rule cooling down as a whole would act on forty breached records in one
    run and then go quiet about the forty-first. Held per record, a second run
    suppresses *every* record it already acted on — and the count says so
    rather than the run silently reporting nothing.
    """
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, cooldown_minutes=60)

    first = _run(client, headers, rule["id"], dry_run=False)
    assert first["fired"] > 1, "this test needs more than one match to mean anything"

    second = _run(client, headers, rule["id"], dry_run=False)
    assert second["matched"] == first["matched"]

    # Every record the first run acted on is now held back — that is the
    # requirement, stated as the count. Asserting `second["fired"] == 0`
    # instead would only hold while the whole match set fitted inside one
    # run's fire budget, and would start failing as the table grew for a
    # reason that has nothing to do with the cooldown.
    assert second["suppressed"] == first["fired"]

    # And nothing was acted on twice: the records the second run fired on are
    # different records, which is the same claim from the other side.
    acted = {item["record_id"] for item in first["sample"] if item["state"] == "FIRED"}
    again = {item["record_id"] for item in second["sample"] if item["state"] == "FIRED"}
    assert acted and not (acted & again)


def test_a_zero_cooldown_fires_every_time(client, monkeypatch):
    """A cooldown is a choice, and "no cooldown" has to mean no cooldown."""
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, cooldown_minutes=0)

    first = _run(client, headers, rule["id"], dry_run=False)
    second = _run(client, headers, rule["id"], dry_run=False)
    assert second["fired"] == first["fired"]
    assert second["suppressed"] == 0


def test_the_rule_says_which_records_it_is_holding_back_and_until_when(
    client, monkeypatch
):
    """The answer to "why has it gone quiet", derived rather than stored."""
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, cooldown_minutes=120)
    _run(client, headers, rule["id"], dry_run=False)

    detail = client.get(f"{RULES}/{rule['id']}", headers=headers).get_json()
    assert detail["cooling_down"], "it just fired on several records"
    entry = detail["cooling_down"][0]
    assert entry["record"] and entry["until"] > entry["last_fired_at"]


def test_shortening_the_cooldown_takes_effect_immediately(client, monkeypatch):
    """Which is why the expiry is derived at read time and never stored."""
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, cooldown_minutes=600)
    _run(client, headers, rule["id"], dry_run=False)
    assert client.get(f"{RULES}/{rule['id']}", headers=headers).get_json()["cooling_down"]

    client.put(f"{RULES}/{rule['id']}", json={"cooldown_minutes": 0}, headers=headers)
    detail = client.get(f"{RULES}/{rule['id']}", headers=headers).get_json()
    assert detail["cooling_down"] == []
