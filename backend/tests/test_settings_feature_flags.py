"""System settings and feature flags (§11, §27). — Feature flags."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.core.db import session_scope
from src.services.platform import settings as service
from tests.settings_support import (  # noqa: F401
    FLAGS,
    PREFIX,
    _authenticate,
    _Flag,
    pytestmark,
)


def test_every_flag_says_whether_it_is_on_for_this_reader(client, monkeypatch):
    """"It is enabled but I do not have it" is the commonest question a flag
    screen gets."""
    headers = _authenticate(monkeypatch)
    answer = client.get(FLAGS, headers=headers).get_json()

    assert answer["items"], "the seed writes flags"
    for item in answer["items"]:
        assert isinstance(item["on_for_me"], bool)
        # A flag that is off is off for everybody, whatever its rollout says.
        if not item["enabled"]:
            assert item["on_for_me"] is False


def test_a_flag_is_created_off_whatever_was_asked_for(client, monkeypatch):
    """One that arrived enabled would ship whatever it guards at the moment it
    was created, which is the opposite of what a flag is for."""
    headers = _authenticate(monkeypatch)
    created = client.post(
        FLAGS,
        json={"key": "settings-test-flag", "name": "Settings test flag", "enabled": True},
        headers=headers,
    )
    assert created.status_code == 201, created.get_data(as_text=True)
    body = created.get_json()
    assert body["enabled"] is False
    assert body["rollout_percentage"] == 0
    assert body["on_for_me"] is False

    assert client.delete(f"{FLAGS}/settings-test-flag", headers=headers).status_code == 200


def test_two_flags_cannot_share_a_key(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    client.post(FLAGS, json={"key": "dup-test", "name": "First"}, headers=headers)
    try:
        again = client.post(FLAGS, json={"key": "dup-test", "name": "Second"}, headers=headers)
        assert again.status_code == 409
    finally:
        client.delete(f"{FLAGS}/dup-test", headers=headers)


def test_a_live_flag_cannot_be_deleted(client, monkeypatch):
    """Removing a flag something is reading turns a guarded feature into an
    unguarded one, and the person who deletes it is rarely the person who
    finds out."""
    headers = _authenticate(monkeypatch)
    client.post(FLAGS, json={"key": "live-test", "name": "Live test"}, headers=headers)
    try:
        client.put(f"{FLAGS}/live-test", json={"enabled": True}, headers=headers)
        response = client.delete(f"{FLAGS}/live-test", headers=headers)
        assert response.status_code == 409
        assert "Turn it off first" in response.get_json()["message"]

        client.put(f"{FLAGS}/live-test", json={"enabled": False}, headers=headers)
        assert client.delete(f"{FLAGS}/live-test", headers=headers).status_code == 200
    except Exception:
        client.put(f"{FLAGS}/live-test", json={"enabled": False}, headers=headers)
        client.delete(f"{FLAGS}/live-test", headers=headers)
        raise


def test_a_rollout_is_a_percentage_and_says_so(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    client.post(FLAGS, json={"key": "pct-test", "name": "Percentage test"}, headers=headers)
    try:
        for value in (-1, 101, "half"):
            response = client.put(
                f"{FLAGS}/pct-test", json={"rollout_percentage": value}, headers=headers
            )
            assert response.status_code == 400, value
    finally:
        client.delete(f"{FLAGS}/pct-test", headers=headers)


def test_last_toggled_moves_only_when_the_switch_does(client, monkeypatch):
    """So "last toggled" answers "when did this change" rather than "when was
    this row last written"."""
    headers = _authenticate(monkeypatch)
    client.post(FLAGS, json={"key": "toggle-test", "name": "Toggle test"}, headers=headers)
    try:
        first = client.put(
            f"{FLAGS}/toggle-test", json={"enabled": True}, headers=headers
        ).get_json()
        assert first["last_toggled_at"] is not None

        # A write that does not move the switch leaves the stamp alone.
        again = client.put(
            f"{FLAGS}/toggle-test",
            json={"enabled": True, "description": "Still on."},
            headers=headers,
        ).get_json()
        assert again["last_toggled_at"] == first["last_toggled_at"]
    finally:
        client.put(f"{FLAGS}/toggle-test", json={"enabled": False}, headers=headers)
        client.delete(f"{FLAGS}/toggle-test", headers=headers)


def test_toggling_a_flag_is_audited(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    client.post(FLAGS, json={"key": "audit-test", "name": "Audit test"}, headers=headers)
    try:
        client.put(f"{FLAGS}/audit-test", json={"enabled": True}, headers=headers)

        from src.models.platform import AuditLog

        with session_scope() as session:
            entry = session.scalars(
                select(AuditLog)
                .where(
                    AuditLog.resource_type == "feature_flag",
                    AuditLog.resource_label == "Audit test",
                    AuditLog.action == "FLAG_CHANGE",
                )
                .order_by(AuditLog.occurred_at.desc())
            ).first()
        assert entry is not None
        assert entry.state_before["enabled"] is False
        assert entry.state_after["enabled"] is True
    finally:
        client.put(f"{FLAGS}/audit-test", json={"enabled": False}, headers=headers)
        client.delete(f"{FLAGS}/audit-test", headers=headers)


def test_a_flag_that_is_off_is_off_for_everybody():
    from uuid import uuid4

    flag = _Flag(enabled=False, rollout_percentage=100, target_roles=["ADMINISTRATOR"])
    assert service.is_on(flag, user_id=uuid4(), role_code="ADMINISTRATOR") is False


def test_a_named_person_always_has_it():
    """That is what naming them is for — it beats the percentage."""
    from uuid import uuid4

    me = uuid4()
    flag = _Flag(rollout_percentage=0, target_user_ids=[str(me)])
    assert service.is_on(flag, user_id=me, role_code="VIEWER") is True
    assert service.is_on(flag, user_id=uuid4(), role_code="VIEWER") is False


def test_a_role_target_beats_the_percentage():
    from uuid import uuid4

    flag = _Flag(rollout_percentage=0, target_roles=["MANAGER"])
    assert service.is_on(flag, user_id=uuid4(), role_code="MANAGER") is True
    assert service.is_on(flag, user_id=uuid4(), role_code="VIEWER") is False


def test_a_hundred_per_cent_is_everybody_and_nought_is_nobody():
    from uuid import uuid4

    assert service.is_on(_Flag(rollout_percentage=100), user_id=uuid4(), role_code=None) is True
    # Enabled with no rollout and no targets means "on for the people it
    # names", which is nobody — a flag claiming to be on for everybody at
    # nought per cent would make the number meaningless.
    assert service.is_on(_Flag(rollout_percentage=0), user_id=uuid4(), role_code=None) is False


def test_a_partial_rollout_is_stable_for_one_person():
    """A flag that flickered on and off between requests would be worse than
    no flag: the feature would half-appear and every bug report about it would
    be unreproducible."""
    from uuid import uuid4

    flag = _Flag(rollout_percentage=50)
    me = uuid4()
    answers = {service.is_on(flag, user_id=me, role_code=None) for _ in range(50)}
    assert len(answers) == 1


def test_a_partial_rollout_reaches_roughly_the_share_it_names():
    from uuid import uuid4

    flag = _Flag(rollout_percentage=30)
    people = [uuid4() for _ in range(600)]
    reached = sum(1 for person in people if service.is_on(flag, user_id=person, role_code=None))
    # Wide bounds on purpose: the claim is that the number *means* something,
    # not that a hash is uniform to two decimal places.
    assert 120 <= reached <= 240, reached


def test_a_partial_rollout_reaches_nobody_it_cannot_identify():
    """An anonymous caller has no stable bucket, so the honest answer is no."""
    assert service.is_on(_Flag(rollout_percentage=50), user_id=None, role_code=None) is False


@pytest.mark.database
def test_a_flag_that_hides_something_shipped_is_on(client, monkeypatch):
    """A rollout percentage is for shipping gradually, not for finished pages.

    The seed applied one to every non-GA flag, and `dashboard-builder` came out
    **disabled at five per cent** — so `/dashboards`, a complete and tested
    page, was absent from the navigation of every demo persona and looked
    deleted. `/import` was there for one reader in ten.

    The flag still exists and turning it off still hides the page, which is
    what a flag is for. What it must not do is decide at random that a shipped
    feature was never built — so every key in `NAVIGATION_FLAGS` is seeded on,
    at a hundred per cent, with nobody singled out (§27).
    """
    from src.seed import catalog, runner
    from src.seed.world import SMALL

    headers = _authenticate(monkeypatch, "admin", "administrator")
    body = client.get(f"{PREFIX}/admin/flags?page_size=100", headers=headers).get_json()
    rows = {row["key"]: row for row in body["items"]}
    # What the *seed* writes, read from the generator: the live database is
    # shared, and somebody switching a flag off in the app (which is what a
    # flag is for) must not fail the suite.
    seeded = {flag.key: flag for flag in runner.generate(scale=SMALL, seed=7).feature_flags}

    for key in sorted(catalog.NAVIGATION_FLAGS):
        # A key named as gating navigation and absent from the platform is the
        # other half of the same bug: the page would be gated on nothing.
        assert rows.get(key) is not None, f"{key} gates navigation and does not exist"
        flag = seeded[key]
        assert flag.enabled is True, key
        assert flag.rollout_percentage == 100, key
        assert not flag.target_user_ids, key
