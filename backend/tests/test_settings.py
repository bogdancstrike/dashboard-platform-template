"""System settings and feature flags (§11, §27).

The claims worth asserting are the ones that decide whether a configuration
screen can be trusted:

  * a setting is **coerced into the type it declares**, because a boolean
    stored as the string `"false"` reads as *true* everywhere it is used —
    the quietest possible configuration bug;
  * a range it declares is enforced, and the refusal names the bound;
  * a **secret is never sent**, in either the value or the default;
  * the default is carried beside the value, so drift is visible and Reset is
    a button;
  * `is_on` is the whole rollout rule in one place, and the percentage is a
    **stable hash** rather than a draw — a flag that flickered between
    requests would be worse than no flag;
  * and a **live flag cannot be deleted**, because removing one that something
    is reading ships whatever it guards to everybody.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.config import Config
from src.core.db import session_scope
from src.services import settings as service
from tests.conftest import persona_claims

pytestmark = pytest.mark.database

PREFIX = Config.API_PREFIX
SETTINGS = f"{PREFIX}/admin/settings"
FLAGS = f"{PREFIX}/admin/flags"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"cfg-{username}"),
    )
    return {"Authorization": f"Bearer cfg-{username}"}


def _find(answer, key: str) -> dict:
    for group in answer["groups"]:
        for item in group["items"]:
            if item["key"] == key:
                return item
    raise AssertionError(f"{key} is not in the settings")


def _restore(key: str) -> None:
    """Put a setting back at its default, whatever a test did to it."""
    from src.models.platform import SystemSetting

    with session_scope() as session:
        row = session.scalar(select(SystemSetting).where(SystemSetting.key == key))
        if row is not None:
            row.value = row.default_value


# ── Access ───────────────────────────────────────────────────────────────


def test_the_configuration_endpoints_need_a_bearer_token(client):
    assert client.get(SETTINGS).status_code == 401
    assert client.get(FLAGS).status_code == 401


def test_reading_the_configuration_is_the_same_privilege_as_changing_it(
    client, monkeypatch
):
    """A setting names an SMTP host and a retention period; a reader who may
    see those is already trusted with them."""
    headers = _authenticate(monkeypatch, "manager", "manager")
    assert client.get(SETTINGS, headers=headers).status_code == 403
    assert client.get(FLAGS, headers=headers).status_code == 403


# ── Settings ─────────────────────────────────────────────────────────────


def test_the_settings_arrive_grouped_with_their_declarations(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.get(SETTINGS, headers=headers).get_json()

    assert answer["groups"], "the screen renders from these"
    assert answer["total"] == sum(len(group["items"]) for group in answer["groups"])

    # The declaration is what the form renders from, so every kind has to
    # arrive: a choice with its choices, a number with its range.
    density = _find(answer, "ui.density")
    assert density["value_type"] == "choice"
    assert "compact" in density["options"]["choices"]

    retention = _find(answer, "retention.audit_days")
    assert retention["value_type"] == "duration"
    assert retention["options"]["minimum"] == 30


def test_a_secret_is_never_sent_in_the_value_or_the_default(client, monkeypatch):
    """A settings screen that renders an API key puts it in a screenshot, a
    browser cache and a support ticket."""
    headers = _authenticate(monkeypatch)
    answer = client.get(SETTINGS, headers=headers).get_json()
    secret = _find(answer, "integrations.webhook_signing_key")

    assert secret["is_secret"] is True
    assert secret["value"] == service.REDACTED
    assert secret["default"] == service.REDACTED
    # And the real one is nowhere in the payload.
    assert "whsec_" not in client.get(SETTINGS, headers=headers).get_data(as_text=True)


def test_a_boolean_is_coerced_and_not_stored_as_a_string(client, monkeypatch):
    """`"false"` stored as a string reads as *true* everywhere it is used."""
    headers = _authenticate(monkeypatch)
    try:
        for sent, expected in (("false", False), ("true", True), (False, False), (True, True)):
            answer = client.put(
                f"{SETTINGS}/security.mfa_required", json={"value": sent}, headers=headers
            )
            assert answer.status_code == 200, answer.get_data(as_text=True)
            assert answer.get_json()["value"] is expected
    finally:
        _restore("security.mfa_required")


def test_a_boolean_that_is_neither_is_refused_by_name(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.put(
        f"{SETTINGS}/security.mfa_required", json={"value": "perhaps"}, headers=headers
    )
    assert response.status_code == 400
    assert "yes-or-no" in response.get_json()["message"]


def test_a_number_is_coerced_and_its_range_is_enforced(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    try:
        # A browser sends "30"; the column holds 30.
        answer = client.put(
            f"{SETTINGS}/retention.log_days", json={"value": "30"}, headers=headers
        ).get_json()
        assert answer["value"] == 30

        too_big = client.put(
            f"{SETTINGS}/retention.log_days", json={"value": 100_000}, headers=headers
        )
        assert too_big.status_code == 400
        assert too_big.get_json()["details"]["maximum"] == 365

        too_small = client.put(
            f"{SETTINGS}/retention.log_days", json={"value": 0}, headers=headers
        )
        assert too_small.status_code == 400
        assert too_small.get_json()["details"]["minimum"] == 1
    finally:
        _restore("retention.log_days")


def test_a_choice_outside_its_own_choices_is_refused_with_the_list(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.put(
        f"{SETTINGS}/ui.density", json={"value": "enormous"}, headers=headers
    )
    assert response.status_code == 400
    assert "comfortable" in response.get_json()["details"]["allowed"]


def test_the_default_is_carried_beside_the_value_and_reset_is_a_button(
    client, monkeypatch
):
    """Knowing what a setting was *shipped* as is the difference between
    "somebody chose this" and "this is how it comes"."""
    headers = _authenticate(monkeypatch)
    try:
        changed = client.put(
            f"{SETTINGS}/notifications.digest_hour", json={"value": 21}, headers=headers
        ).get_json()
        assert changed["value"] == 21
        assert changed["default"] == 7
        assert changed["changed"] is True

        reset = client.put(
            f"{SETTINGS}/notifications.digest_hour", json={"reset": True}, headers=headers
        ).get_json()
        assert reset["value"] == 7
        assert reset["changed"] is False
    finally:
        _restore("notifications.digest_hour")


def test_the_screen_counts_what_differs_from_what_the_platform_ships_with(
    client, monkeypatch
):
    headers = _authenticate(monkeypatch)
    answer = client.get(SETTINGS, headers=headers).get_json()
    counted = sum(
        1 for group in answer["groups"] for item in group["items"] if item["changed"]
    )
    assert answer["changed"] == counted


def test_a_setting_that_does_not_exist_is_a_404_naming_the_key(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.put(f"{SETTINGS}/no.such.setting", json={"value": 1}, headers=headers)
    assert response.status_code == 404
    assert response.get_json()["details"]["key"] == "no.such.setting"


def test_changing_a_setting_is_audited_and_names_the_setting(client, monkeypatch):
    """A bulk write of a configuration document audits as "the settings
    changed", which is the least useful thing an audit trail can say."""
    headers = _authenticate(monkeypatch)
    try:
        client.put(f"{SETTINGS}/limits.max_upload_mb", json={"value": 50}, headers=headers)

        from src.models.platform import AuditLog

        with session_scope() as session:
            entry = session.scalars(
                select(AuditLog)
                .where(
                    AuditLog.resource_type == "system_setting",
                    AuditLog.action == "SETTING_CHANGE",
                )
                .order_by(AuditLog.occurred_at.desc())
            ).first()
        assert entry is not None
        assert entry.resource_label == "Maximum upload size"
        assert entry.state_after["value"] == 50
    finally:
        _restore("limits.max_upload_mb")


# ── Feature flags ────────────────────────────────────────────────────────


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


# ── The rollout rule, as a function ──────────────────────────────────────


class _Flag:
    """The five attributes `is_on` reads, and nothing else."""

    def __init__(self, **overrides):
        self.key = "sample"
        self.enabled = True
        self.rollout_percentage = 0
        self.target_user_ids = None
        self.target_roles = None
        for name, value in overrides.items():
            setattr(self, name, value)


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
