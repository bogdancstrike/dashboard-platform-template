"""Workflow rules: the payload checks and guards the HTTP tests do not reach."""

from __future__ import annotations

import pytest

from src.core.errors import ValidationError
from src.services.automation.workflows import queries
from src.services.automation.workflows.validation import _validated, _validated_actions, _whole
from src.services.automation.workflows.webhook import _NoRedirect, _webhook_url
from tests.personas import principal


@pytest.mark.parametrize("payload, partial, message", [
    ({}, False, "An automation needs a name."),
    ({"severity": "LOUD"}, True, "Unknown severity."),
    ({"cooldown_minutes": 60 * 24 * 31}, True, "A cooldown runs from 0 minutes to 30 days."),
    ({"cooldown_minutes": "soon"}, True, "cooldown_minutes must be a whole number"),
    ({"condition_tree": ["not", "a", "tree"]}, True, "condition_tree must be a query-builder tree"),
])
def test_a_bad_field_is_refused_with_its_message(payload, partial, message):
    with pytest.raises(ValidationError) as caught:
        _validated(None, payload, principal=None, partial=partial)
    assert caught.value.message == message


def test_a_partial_update_keeps_only_what_it_names():
    values = _validated(None, {"description": "  watch  ", "enabled": 0, "severity": "info",
                               "schedule": "0  9 * * 1"}, principal=None, partial=True)
    assert values == {"description": "watch", "enabled": False, "severity": "INFO",
                      "schedule": "0 9 * * 1"}
    assert _whole("7", "n") == 7


@pytest.mark.parametrize("raw, message", [
    (None, "An automation needs at least one action."),
    ([{"kind": "NOTIFY"}] * 9, "An automation runs at most 8 actions."),
    (["notify"], "each action must be an object"),
    ([{"kind": "DANCE"}], "DANCE is not an action this platform can run."),
    ([{}], "(none) is not an action this platform can run."),
])
def test_an_action_list_is_checked_before_any_action(raw, message):
    with pytest.raises(ValidationError) as caught:
        _validated_actions(None, raw)
    assert caught.value.message == message


@pytest.mark.parametrize("url", ["ftp://example.com/x", "https://", "notaurl"])
def test_a_webhook_needs_a_full_http_address(url):
    with pytest.raises(ValidationError):
        _webhook_url(url)


def test_a_webhook_address_has_a_length_limit_and_redirects_are_not_followed():
    with pytest.raises(ValidationError, match="too long"):
        _webhook_url("https://example.com/" + "a" * 500)
    assert _webhook_url(" https://example.com/hook ") == "https://example.com/hook"
    assert _NoRedirect().redirect_request() is None


@pytest.mark.database
def test_the_list_filters_by_dataset_and_state(app):
    from src.core.db import session_scope

    admin = principal(app, "admin")
    with session_scope() as session:
        everything = queries.list_rules(session, {}, principal=admin)
        enabled = queries.list_rules(session, {"state": "enabled", "resource_type": "task"},
                                     principal=admin)
        paused = queries.list_rules(session, {"state": "PAUSED"}, principal=admin)
    total = everything.get("total", len(everything.get("items", [])))
    assert enabled.get("total", 0) <= total and paused.get("total", 0) <= total
    assert all(item["resource_type"] == "task" for item in enabled.get("items", []))
