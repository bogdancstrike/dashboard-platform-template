"""System settings and feature flags (§11, §27). — Access."""

from __future__ import annotations

from sqlalchemy import select

from src.core.db import session_scope
from src.services.platform import settings as service
from tests.settings_support import (  # noqa: F401
    FLAGS,
    SETTINGS,
    _authenticate,
    _find,
    _restore,
    pytestmark,
)


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
