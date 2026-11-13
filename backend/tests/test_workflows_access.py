"""Condition → action automation (§49). — Access."""

from __future__ import annotations

from tests.workflows_support import (  # noqa: F401
    CATALOG,
    RULES,
    _authenticate,
    _condition,
    _rule,
    _run,
    pytestmark,
)


def test_the_automation_endpoints_need_a_bearer_token(client):
    assert client.get(RULES).status_code == 401
    assert client.get(CATALOG).status_code == 401


def test_reading_the_automations_is_privileged(client, monkeypatch):
    """A rule's condition quotes values from records its reader may not see.

    So the permission gates the *list*, not only the writing — which is the
    opposite of announcements, where reading is what everybody does.
    """
    headers = _authenticate(monkeypatch, "analyst", "analyst")
    assert client.get(RULES, headers=headers).status_code == 403


def test_a_manager_may_write_automations(client, monkeypatch):
    headers = _authenticate(monkeypatch, "manager", "manager")
    assert client.get(RULES, headers=headers).status_code == 200


def test_the_catalogue_offers_only_resources_the_engine_can_select_from(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.get(CATALOG, headers=headers).get_json()

    from src.services.records.explorer import resources

    assert {item["key"] for item in answer["resources"]} <= set(resources())
    assert answer["resources"], "the editor cannot offer nothing"


def test_the_catalogue_declares_what_each_action_needs(client, monkeypatch):
    """The form asks for exactly what the executor reads (§76)."""
    headers = _authenticate(monkeypatch)
    answer = client.get(CATALOG, headers=headers).get_json()
    needs = {item["kind"]: item["needs"] for item in answer["actions"]}

    assert needs["NOTIFY"] == ["recipients"]
    assert needs["WEBHOOK"] == ["url"]
    # A task needs nothing beyond the rule itself — it has a title to fall
    # back on and the queue takes it unassigned.
    assert needs["TASK"] == []


def test_an_automation_with_no_action_is_refused(client, monkeypatch):
    """It would match, record fires and do nothing — the worst state."""
    headers = _authenticate(monkeypatch)
    response = client.post(
        RULES,
        json={"name": "Does nothing", "resource_type": "task",
              "condition_tree": _condition(), "actions": []},
        headers=headers,
    )
    assert response.status_code == 400
    assert "at least one action" in response.get_json()["message"]


def test_an_unknown_action_is_named_rather_than_ignored(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.post(
        RULES,
        json={"name": "Sends a pigeon", "resource_type": "task",
              "condition_tree": _condition(), "actions": [{"kind": "PIGEON"}]},
        headers=headers,
    )
    assert response.status_code == 400
    body = response.get_json()
    assert "PIGEON" in body["message"]
    assert "NOTIFY" in body["details"]["allowed"]


def test_an_action_that_reaches_nobody_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.post(
        RULES,
        json={"name": "Tells nobody", "resource_type": "task",
              "condition_tree": _condition(),
              "actions": [{"kind": "NOTIFY", "recipients": {}}]},
        headers=headers,
    )
    assert response.status_code == 400
    assert "who it reaches" in response.get_json()["message"]


def test_a_webhook_target_is_checked_when_the_rule_is_saved(client, monkeypatch):
    """Not when it fires. A rule cannot sit in the table carrying a target the
    engine would refuse."""
    headers = _authenticate(monkeypatch)
    response = client.post(
        RULES,
        json={"name": "Calls a file", "resource_type": "task",
              "condition_tree": _condition(),
              "actions": [{"kind": "WEBHOOK", "url": "file:///etc/passwd"}]},
        headers=headers,
    )
    assert response.status_code == 400
    assert "http" in response.get_json()["message"]


def test_a_condition_naming_a_field_that_is_not_there_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.post(
        RULES,
        json={"name": "Watches nothing", "resource_type": "task",
              "condition_tree": _condition("unicorn_count", ("7",)),
              "actions": [{"kind": "TASK"}]},
        headers=headers,
    )
    assert response.status_code == 400
    assert "unicorn_count" in response.get_json()["message"]


def test_a_schedule_is_five_cron_fields(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.post(
        RULES,
        json={"name": "Runs on Tuesdays sometime", "resource_type": "task",
              "condition_tree": _condition(), "actions": [{"kind": "TASK"}],
              "schedule": "every fifteen minutes"},
        headers=headers,
    )
    assert response.status_code == 400
    assert "five cron fields" in response.get_json()["message"]


def test_the_stored_text_is_rendered_by_the_same_module_that_compiles_it(
    client, monkeypatch
):
    """The whole point of an inspector is that it cannot drift (§51)."""
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, condition_tree=_condition("status", ("NEW", "BLOCKED")))

    from src.core.rules import describe_tree
    from src.services.records.explorer import resources

    expected = describe_tree(rule["condition_tree"], resources()["task"].fields)
    assert rule["condition_text"] == expected
    assert "Status" in rule["condition_text"]


def test_a_rule_with_no_condition_matches_nothing(client, monkeypatch):
    """Reading "no conditions" as "everything" is the reading that sends the
    forty messages."""
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, condition_tree=None)
    assert _run(client, headers, rule["id"])["matched"] == 0
